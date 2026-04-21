#!/usr/bin/env python3
"""
Parking.OS — YOLO v8n vehicle detector
Uruchamiany przez Tauri jako subprocess.

Args:
  --rtsp <url>    RTSP stream URL kamery CAM 1
  --db   <path>   Ścieżka do detection.db (SQLite)
  --port <int>    Port HTTP status server (default: 8890)
  --roi  <x1,y1,x2,y2>  ROI jako ułamki klatki 0.0-1.0 (default: 0.3,0.3,0.7,0.65)
  --line <float>  Pozycja linii detekcji wewnątrz ROI (default: 0.6)

HTTP API:
  GET http://127.0.0.1:<port>/status  →  JSON z licznikami
"""

import sys
import argparse
import sqlite3
import time
import json
import threading
from datetime import date, datetime
from http.server import HTTPServer, BaseHTTPRequestHandler

import cv2
import numpy as np
from ultralytics import YOLO

# ── Konfiguracja ──────────────────────────────────────────────────────────────
VEHICLE_CLASSES = {2: 'car', 5: 'bus', 7: 'truck'}   # COCO class IDs
CONF_THRESHOLD  = 0.35
SAMPLE_INTERVAL = 0.33     # sekund między klatkami (~3 fps) — szybszy sampling dla bramy
MAX_DISAPPEARED = 10       # klatek nieobecności przed usunięciem śladu
MAX_DISTANCE    = 250      # piksele — maks odległość do przypisania śladu (zwiększone dla 3fps)

# ── Centroid Tracker ──────────────────────────────────────────────────────────
class CentroidTracker:
    def __init__(self):
        self.next_id     = 0
        self.objects     = {}       # id → (cx, cy)
        self.disappeared = {}       # id → liczba klatek bez detekcji
        self.first_y     = {}       # id → y przy pierwszym wykryciu
        self.last_y      = {}       # id → y przy ostatnim wykryciu

    def _register(self, centroid):
        self.objects[self.next_id]     = centroid
        self.disappeared[self.next_id] = 0
        self.first_y[self.next_id]     = centroid[1]
        self.last_y[self.next_id]      = centroid[1]
        self.next_id += 1

    def _deregister(self, obj_id):
        """Usuwa ślad i zwraca (first_y, last_y) dla późniejszego sprawdzenia przekroczenia."""
        fy = self.first_y.pop(obj_id, None)
        ly = self.last_y.pop(obj_id, self.objects[obj_id][1])
        del self.objects[obj_id]
        del self.disappeared[obj_id]
        return fy, ly

    def update(self, centroids):
        """
        Zwraca:
          matches   — dict {id: (old_centroid, new_centroid)} dla zaktualizowanych śladów
          gone      — list[(obj_id, first_y, last_y)] śladów właśnie usuniętych
        """
        gone = []

        if not centroids:
            for oid in list(self.disappeared):
                self.disappeared[oid] += 1
                if self.disappeared[oid] > MAX_DISAPPEARED:
                    fy, ly = self._deregister(oid)
                    gone.append((oid, fy, ly))
            return {}, gone

        if not self.objects:
            for c in centroids:
                self._register(c)
            return {}, gone

        obj_ids       = list(self.objects.keys())
        obj_centroids = list(self.objects.values())

        # Macierz odległości
        D = np.array([
            [np.hypot(oc[0]-nc[0], oc[1]-nc[1]) for nc in centroids]
            for oc in obj_centroids
        ], dtype=np.float32)

        used_rows = set()
        used_cols = set()
        matches   = {}

        for _ in range(min(len(obj_centroids), len(centroids))):
            idx      = int(np.argmin(D))
            row, col = divmod(idx, D.shape[1])
            if row in used_rows or col in used_cols or D[row, col] > MAX_DISTANCE:
                D[row, col] = 1e9
                continue
            oid = obj_ids[row]
            matches[oid]          = (self.objects[oid], centroids[col])
            self.objects[oid]     = centroids[col]
            self.last_y[oid]      = centroids[col][1]   # aktualizuj last_y
            self.disappeared[oid] = 0
            used_rows.add(row)
            used_cols.add(col)
            D[row, col] = 1e9

        for row in range(len(obj_centroids)):
            if row not in used_rows:
                oid = obj_ids[row]
                self.disappeared[oid] += 1
                if self.disappeared[oid] > MAX_DISAPPEARED:
                    fy, ly = self._deregister(oid)
                    gone.append((oid, fy, ly))

        for col in range(len(centroids)):
            if col not in used_cols:
                self._register(centroids[col])

        return matches, gone


# ── SQLite ────────────────────────────────────────────────────────────────────
def init_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS crossings (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            ts        TEXT NOT NULL,
            direction TEXT NOT NULL CHECK(direction IN ('in','out')),
            date      TEXT NOT NULL
        )
    """)
    conn.commit()
    return conn


def record_crossing(conn: sqlite3.Connection, direction: str):
    now = datetime.now()
    conn.execute(
        "INSERT INTO crossings (ts, direction, date) VALUES (?, ?, ?)",
        (now.isoformat(), direction, now.strftime('%Y-%m-%d'))
    )
    conn.commit()


def get_today_counts(conn: sqlite3.Connection):
    today = date.today().isoformat()
    c_in  = conn.execute(
        "SELECT COUNT(*) FROM crossings WHERE date=? AND direction='in'",  (today,)
    ).fetchone()[0]
    c_out = conn.execute(
        "SELECT COUNT(*) FROM crossings WHERE date=? AND direction='out'", (today,)
    ).fetchone()[0]
    return c_in, c_out


def get_hourly_today(conn: sqlite3.Connection):
    today = date.today().isoformat()
    rows = conn.execute(
        """SELECT strftime('%H', ts) as h, direction, COUNT(*) as cnt
           FROM crossings WHERE date=?
           GROUP BY h, direction ORDER BY h""",
        (today,)
    ).fetchall()
    result = {}
    for h, d, cnt in rows:
        hour = int(h)
        if hour not in result:
            result[hour] = {'in': 0, 'out': 0}
        result[hour][d] = cnt
    return result


# ── HTTP Status Server ────────────────────────────────────────────────────────
class StatusHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Wycisz logi HTTP

    def do_GET(self):
        if self.path.rstrip('/') not in ('/status', '/hourly'):
            self.send_response(404)
            self.end_headers()
            return

        if self.path.rstrip('/') == '/hourly':
            data = get_hourly_today(self.server.db_conn)
            body = json.dumps(data).encode()
        else:
            body = json.dumps(self.server.app_state).encode()

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)


def start_http_server(port: int, state: dict, conn: sqlite3.Connection):
    server          = HTTPServer(('127.0.0.1', port), StatusHandler)
    server.app_state = state
    server.db_conn  = conn
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ── Główna pętla detekcji ─────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Parking.OS YOLO detector')
    parser.add_argument('--rtsp',  required=True,        help='RTSP URL kamery')
    parser.add_argument('--db',    required=True,        help='Ścieżka do detection.db')
    parser.add_argument('--port',  type=int, default=8890)
    parser.add_argument('--roi',   default='0.3,0.3,0.7,0.65',
                        help='ROI jako ułamki: x1,y1,x2,y2')
    parser.add_argument('--line',  type=float, default=0.6,
                        help='Pozycja linii detekcji w ROI (0.0-1.0)')
    args = parser.parse_args()

    conn = init_db(args.db)
    today_in, today_out = get_today_counts(conn)

    state = {
        'running':    True,
        'today_in':   today_in,
        'today_out':  today_out,
        'on_parking': max(0, today_in - today_out),
        'last_event': None,
        'fps':        0.0,
        'error':      None,
        'roi':        args.roi,
        'line':       args.line,
    }

    start_http_server(args.port, state, conn)
    print(f'[detector] HTTP status on :{ args.port}', flush=True)

    # Wczytaj model YOLO (pobierze yolov8n.pt ~6MB przy pierwszym uruchomieniu)
    print('[detector] Ładowanie modelu YOLO v8n...', flush=True)
    model = YOLO('yolov8n.pt')
    print('[detector] Model gotowy.', flush=True)

    roi_parts = [float(x) for x in args.roi.split(',')]
    tracker   = CentroidTracker()
    counted   = set()   # IDs które zostały już zliczone (zapobiega podwójnemu liczeniu)

    cap             = None
    reconnect_delay = 5

    while True:
        # ── Połączenie z RTSP ──
        if cap is None or not cap.isOpened():
            print('[detector] Łączenie z RTSP...', flush=True)
            cap = cv2.VideoCapture(args.rtsp, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not cap.isOpened():
                state['error'] = 'Brak połączenia z kamerą'
                print(f'[detector] Błąd RTSP, retry za {reconnect_delay}s', flush=True)
                time.sleep(reconnect_delay)
                continue
            state['error'] = None
            print('[detector] Połączono z kamerą.', flush=True)

        ret, frame = cap.read()
        if not ret:
            cap.release()
            cap = None
            time.sleep(reconnect_delay)
            continue

        t0   = time.time()
        h, w = frame.shape[:2]

        # ── ROI ──
        x1 = int(roi_parts[0] * w)
        y1 = int(roi_parts[1] * h)
        x2 = int(roi_parts[2] * w)
        y2 = int(roi_parts[3] * h)
        roi_frame = frame[y1:y2, x1:x2]
        roi_h     = y2 - y1
        line_y    = int(args.line * roi_h)

        # ── Detekcja YOLO ──
        results  = model(
            roi_frame,
            conf=CONF_THRESHOLD,
            classes=list(VEHICLE_CLASSES.keys()),
            verbose=False,
            imgsz=320       # mniejszy rozmiar = szybciej na słabym CPU
        )
        state['fps'] = round(1.0 / max(0.001, time.time() - t0), 2)

        centroids = []
        if results and results[0].boxes is not None:
            for box in results[0].boxes:
                bx1, by1, bx2, by2 = box.xyxy[0].tolist()
                cx = int((bx1 + bx2) / 2)
                cy = int((by1 + by2) / 2)
                centroids.append((cx, cy))

        # ── Śledzenie ──
        matches, gone = tracker.update(centroids)

        # ── Metoda 1: detekcja mid-track (pojazd wolno poruszający się) ──
        # Wykrywa przekroczenie linii między dwoma kolejnymi klatkami.
        for obj_id, (old_c, new_c) in matches.items():
            if obj_id in counted:
                continue
            old_y, new_y = old_c[1], new_c[1]
            if old_y < line_y <= new_y:
                counted.add(obj_id)
                record_crossing(conn, 'in')
                state['today_in']   += 1
                state['on_parking']  = max(0, state['today_in'] - state['today_out'])
                state['last_event']  = {'direction': 'in',  'ts': datetime.now().isoformat()}
                print(f'[detector] >>> WJAZD (mid) #{state["today_in"]}', flush=True)
            elif old_y >= line_y > new_y:
                counted.add(obj_id)
                record_crossing(conn, 'out')
                state['today_out']  += 1
                state['on_parking']  = max(0, state['today_in'] - state['today_out'])
                state['last_event']  = {'direction': 'out', 'ts': datetime.now().isoformat()}
                print(f'[detector] <<< WYJAZD (mid) #{state["today_out"]}', flush=True)

        # ── Metoda 2: detekcja na podstawie trajektorii (szybkie pojazdy) ──
        # Gdy ślad znika, sprawdzamy czy w trakcie swojego życia przekroczył linię
        # (first_y po jednej stronie, last_y po drugiej). Działa nawet gdy auto
        # przejeżdżało tak szybko, że nigdy nie było widoczne na obu stronach linii
        # w tym samym kroku.
        for obj_id, first_y, last_y in gone:
            counted.discard(obj_id)   # zwolnij slot gdy ślad znika
            if first_y is None:
                continue
            # Sprawdź czy trajektoria przeszła przez linię
            crossed_down = first_y < line_y and last_y >= line_y   # wjazd
            crossed_up   = first_y >= line_y and last_y < line_y   # wyjazd
            if crossed_down or crossed_up:
                direction = 'in' if crossed_down else 'out'
                record_crossing(conn, direction)
                if direction == 'in':
                    state['today_in']  += 1
                    print(f'[detector] >>> WJAZD (trajektoria) #{state["today_in"]}', flush=True)
                else:
                    state['today_out'] += 1
                    print(f'[detector] <<< WYJAZD (trajektoria) #{state["today_out"]}', flush=True)
                state['on_parking'] = max(0, state['today_in'] - state['today_out'])
                state['last_event'] = {'direction': direction, 'ts': datetime.now().isoformat()}

        # ── Sleep do ~3 fps ──
        elapsed    = time.time() - t0
        sleep_time = max(0.0, SAMPLE_INTERVAL - elapsed)
        time.sleep(sleep_time)


if __name__ == '__main__':
    main()
