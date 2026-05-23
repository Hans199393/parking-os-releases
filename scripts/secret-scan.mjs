import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagedOnly = process.argv.includes('--staged');

const textExtensions = new Set([
  '.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx', '.json', '.md', '.html', '.css',
  '.yml', '.yaml', '.env', '.txt', '.sql', '.toml', '.rs', '.ps1', '.sh', '.nsh', '.conf'
]);

const forbiddenTrackedPaths = [/^(?:\.env|rtsp-proxy\/\.env|public-config\.js)$/i];
const placeholderTokens = [
  'TWOJ_ANON_KEY',
  'TWOJE_HASLO',
  'YOUR_',
  'CHANGE_ME',
  'CHANGE-ME',
  'REPLACE_ME',
  'xxxxxxxx',
  '<SUPABASE SERVICE ROLE KEY>',
  '<USTAW WLASNY TOKEN>',
  '<USTAW WLASNE HASLO>',
  '<USTAW WLASNE HASLO>',
  '<META MESSENGER ACCESS TOKEN>',
  '<GENERATE',
  '<WYG',
  'PLACEHOLDER',
  'DOWOLNY',
  'DOWOLNE',
  'WYMYSLONY CIAG',
  'TOKEN ZE STRONY META'
];

function gitList(commandArgs) {
  const out = execFileSync('git', commandArgs, { cwd: repoRoot, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function listFiles() {
  if (stagedOnly) {
    return gitList(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
  }
  return gitList(['ls-files', '-z']);
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (textExtensions.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  return base === '.gitignore' || base === '.env' || base.endsWith('.example');
}

function isPlaceholder(value) {
  const normalized = value.trim().replace(/^['"`]|['"`]$/g, '');
  if (!normalized) return true;
  if (/^<.*>$/.test(normalized)) return true;
  return placeholderTokens.some(token => normalized.toUpperCase().includes(token));
}

function looksSensitiveValue(value) {
  const normalized = value.trim().replace(/^['"`]|['"`]$/g, '');
  if (isPlaceholder(normalized)) return false;
  if (/gsk_[A-Za-z0-9]{20,}/.test(normalized)) return true;
  if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(normalized)) return true;
  if (/^\$2[aby]\$/.test(normalized)) return true;
  if (/rtsp:\/\/[^\s:'"`]+:[^@\s'"`]+@/i.test(normalized)) return true;
  if (normalized.length >= 20 && !/\s/.test(normalized)) return true;
  if (normalized.length >= 12 && /[A-Za-z]/.test(normalized) && /\d/.test(normalized) && /[^A-Za-z0-9_-]/.test(normalized) && !/\s/.test(normalized)) return true;
  return false;
}

function addIssue(issues, filePath, lineNo, rule, line) {
  issues.push({ filePath, lineNo, rule, line: line.trim() });
}

function scanLine(issues, filePath, lineNo, line) {
  const docFile = /\.(md|txt|html)$/i.test(filePath);

  if (/gsk_[A-Za-z0-9]{20,}/.test(line)) {
    addIssue(issues, filePath, lineNo, 'Groq API key', line);
  }

  if (/rtsp:\/\/[^\s:'"`]+:[^@\s'"`]+@/i.test(line) && !isPlaceholder(line) && !/(przykład|przyklad|example)/i.test(line)) {
    addIssue(issues, filePath, lineNo, 'RTSP credentials in tracked file', line);
  }

  const envAssignment = line.match(/^\s*(?:export\s+)?(SUPABASE_ANON_KEY|SUPABASE_SERVICE_KEY|GROQ_API_KEY|LLM_API_KEY|ADMIN_TOKEN|ADMIN_PASSWORD|EMAIL_PASS|supabase_key|admin_token|groq_api_key|auth_password_hash|email_pass)\s*=\s*(.+?)\s*$/i);
  if (envAssignment && looksSensitiveValue(envAssignment[2])) {
    addIssue(issues, filePath, lineNo, 'Hardcoded secret assignment', line);
  }

  const objectAssignment = line.match(/["'`]?(supabase_key|admin_token|groq_api_key|auth_password_hash|email_pass|SUPABASE_ANON_KEY|SUPABASE_SERVICE_KEY|ADMIN_TOKEN|ADMIN_PASSWORD|EMAIL_PASS|GROQ_API_KEY)["'`]?\s*:\s*(["'`])([^"'`]+)\2/i);
  if (objectAssignment && looksSensitiveValue(objectAssignment[3])) {
    addIssue(issues, filePath, lineNo, 'Hardcoded secret assignment', line);
  }

  const directLiteralAssignment = line.match(/^\s*(?:const|let|var)\s+(SUPABASE_ANON_KEY|SUPABASE_SERVICE_KEY|GROQ_API_KEY|LLM_API_KEY|ADMIN_TOKEN|ADMIN_PASSWORD|EMAIL_PASS)\s*=\s*(["'`])([^"'`]+)\2/i);
  if (directLiteralAssignment && looksSensitiveValue(directLiteralAssignment[3])) {
    addIssue(issues, filePath, lineNo, 'Hardcoded secret assignment', line);
  }

  if (/(supabase|anon|service|token|key|jwt|groq)/i.test(line)) {
    const jwtMatch = line.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
    if (jwtMatch && !isPlaceholder(jwtMatch[0])) {
      addIssue(issues, filePath, lineNo, 'JWT-like secret', line);
    }
  }

  if (docFile) {
    const documentedSecret = line.match(/\|\s*`?(SUPABASE_SERVICE_KEY|SUPABASE_ANON_KEY|GROQ_API_KEY|ADMIN_TOKEN|ADMIN_PASSWORD|EMAIL_PASS)`?\s*\|\s*`([^`]+)`\s*\|/i);
    if (documentedSecret && looksSensitiveValue(documentedSecret[2])) {
      addIssue(issues, filePath, lineNo, 'Hardcoded secret assignment', line);
    }

    const passwordLabel = line.match(/^\s*(?:\*\*)?(Hasło|Haslo|Password)(?:\*\*)?\s*:\s*`?([^`\s][^`]*)`?\s*$/i);
    if (passwordLabel && looksSensitiveValue(passwordLabel[2])) {
      addIssue(issues, filePath, lineNo, 'Plaintext password in documentation', line);
    }
  }
}

function main() {
  const files = listFiles();
  const issues = [];

  for (const filePath of files) {
    if (forbiddenTrackedPaths.some(pattern => pattern.test(filePath.replace(/\\/g, '/')))) {
      addIssue(issues, filePath, 1, 'Forbidden tracked local config file', filePath);
      continue;
    }

    if (!isTextFile(filePath)) continue;

    const absPath = path.join(repoRoot, filePath);
    let content;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\u0000')) continue;

    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => scanLine(issues, filePath, index + 1, line));
  }

  if (issues.length) {
    console.error('Secret scan failed. Remove the following before commit/push:');
    for (const issue of issues) {
      console.error(`- ${issue.filePath}:${issue.lineNo} [${issue.rule}] ${issue.line}`);
    }
    process.exit(1);
  }

  console.log(`Secret scan passed (${stagedOnly ? 'staged changes' : 'tracked files'}).`);
}

main();