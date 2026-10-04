import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
dotenv.config({ path: resolve(root, '.env') });
export function loadConfig(env = process.env) {
  const secret = env.JWT_SECRET || randomBytes(32).toString('hex');
  return {
    port: +(env.PORT ?? 4000), jwtSecret: secret, jwtGenerated: !env.JWT_SECRET,
    instructorCode: env.INSTRUCTOR_CODE ?? 'instructor-demo', adminCode: env.ADMIN_CODE ?? null,
    googleClientId: env.GOOGLE_CLIENT_ID ?? null,
    modelPath: env.MODEL_PATH ?? resolve(root, 'results/v1/model/model.json'),
    summaryPath: env.MODEL_SUMMARY ?? resolve(root, 'results/v1/metrics/primary_summary.json'),
    dataFile: env.DATA_FILE ?? null, mongoUri: env.MONGO_URI ?? null, webDist: resolve(root, 'apps/web/dist'),
  };
}
