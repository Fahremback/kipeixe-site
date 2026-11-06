import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const credentialsPath = resolve(root, '.local-admin-credentials.txt');
const varsPath = resolve(root, '.dev.vars');
if (existsSync(credentialsPath) || existsSync(varsPath)) {
  console.log('Credenciais locais já existem; nenhum segredo foi substituído.');
  process.exit(0);
}
const username = 'gestor-kipeixe-' + randomBytes(4).toString('hex');
const password = randomBytes(24).toString('base64url');
const salt = randomBytes(24).toString('hex');
const hashed = pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex');
const localWebhook = randomBytes(32).toString('hex');
const productionWebhook = randomBytes(32).toString('hex');
writeFileSync(credentialsPath, `ACESSO ADMINISTRATIVO KIPEIXE\nUsuário: ${username}\nSenha: ${password}\n\nGuarde estes dados em local seguro. Não publique este arquivo.\n`, { flag: 'wx', mode: 0o600 });
writeFileSync(varsPath,
  `ADMIN_USERNAME=${JSON.stringify(username)}\nADMIN_PASSWORD_SALT=${JSON.stringify(salt)}\nADMIN_PASSWORD_HASH=${JSON.stringify(hashed)}\nASAAS_SANDBOX_API_KEY=\"CHAVE_SANDBOX_NAO_CONFIGURADA\"\nASAAS_SANDBOX_WEBHOOK_TOKEN=${JSON.stringify(localWebhook)}\nASAAS_PRODUCTION_API_KEY=\"CHAVE_PRODUCAO_NAO_CONFIGURADA\"\nASAAS_PRODUCTION_WEBHOOK_TOKEN=${JSON.stringify(productionWebhook)}\nLOCAL_DEVELOPMENT=\"true\"\n`,
  { flag: 'wx', mode: 0o600 });
console.log('Acesso administrativo exclusivo criado no armazenamento local protegido.');
