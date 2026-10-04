import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const match = (doc, f) => Object.entries(f ?? {}).every(([k, v]) => doc[k] === v);
export const newId = () => randomBytes(8).toString('hex');

/** Collections: users, sessions, bandits, settings. Same async interface for MemoryStore (optionally persisted to a JSON file) and MongoStore. */
export class MemoryStore {
  constructor(file = null) {
    this.file = file; this.db = { users: [], sessions: [], bandits: [], settings: [] }; this.pendingWrite = Promise.resolve();
    if (file && existsSync(file)) { try { this.db = { ...this.db, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* start empty */ } }
  }
  persist() {
    if (!this.file) return Promise.resolve();
    const snapshot = JSON.stringify(this.db);
    const write = this.pendingWrite.then(() => writeFile(this.file, snapshot));
    this.pendingWrite = write.catch(() => {});
    return write;
  }
  async insert(c, doc) { const d = { _id: newId(), ...structuredClone(doc) }; this.db[c].push(d); await this.persist(); return structuredClone(d); }
  async findOne(c, f) { const d = this.db[c].find((x) => match(x, f)); return d ? structuredClone(d) : null; }
  async find(c, f, { sort, limit, projection } = {}) {
    let r = this.db[c].filter((x) => match(x, f)).map((x) => {
      if (!projection) return structuredClone(x);
      const selected = Object.keys(projection).filter((key) => projection[key]);
      return Object.fromEntries(selected.filter((key) => x[key] !== undefined).map((key) => [key, structuredClone(x[key])]));
    });
    if (sort) { const [k, dir] = Object.entries(sort)[0]; r.sort((a, b) => (a[k] > b[k] ? 1 : -1) * dir); }
    return limit ? r.slice(0, limit) : r;
  }
  async count(c, f) { return this.db[c].filter((doc) => match(doc, f)).length; }
  async distinct(c, key, f) { return [...new Set(this.db[c].filter((doc) => match(doc, f)).map((doc) => doc[key]).filter((value) => value !== undefined))]; }
  async update(c, id, patch) { const d = this.db[c].find((x) => x._id === id); if (!d) return null; Object.assign(d, structuredClone(patch)); await this.persist(); return structuredClone(d); }
  async upsert(c, f, doc) { const d = this.db[c].find((x) => match(x, f)); if (d) { Object.assign(d, structuredClone(doc)); await this.persist(); return structuredClone(d); } return this.insert(c, { ...f, ...doc }); }
}

export class MongoStore {
  static async connect(uri) {
    const mongoose = (await import('mongoose')).default; await mongoose.connect(uri); const s = new MongoStore(); s.mongoose = mongoose;
    await Promise.all([
      s.col('users').createIndex({ rating: -1 }),
      s.col('sessions').createIndex({ userId: 1, createdAt: -1 }),
      s.col('sessions').createIndex({ status: 1 }),
      s.col('settings').createIndex({ key: 1 }, { unique: true }),
    ]);
    return s;
  }
  col(c) { return this.mongoose.connection.collection(c); }
  async insert(c, doc) { const d = { _id: newId(), ...doc }; await this.col(c).insertOne(d); return d; }
  async findOne(c, f) { return this.col(c).findOne(f ?? {}); }
  async find(c, f, { sort, limit, projection } = {}) { let q = this.col(c).find(f ?? {}, projection ? { projection } : {}); if (sort) q = q.sort(sort); if (limit) q = q.limit(limit); return q.toArray(); }
  async count(c, f) { return this.col(c).countDocuments(f ?? {}); }
  async distinct(c, key, f) { return this.col(c).distinct(key, f ?? {}); }
  async update(c, id, patch) { await this.col(c).updateOne({ _id: id }, { $set: patch }); return this.col(c).findOne({ _id: id }); }
  async upsert(c, f, doc) { await this.col(c).updateOne(f, { $set: doc, $setOnInsert: { _id: newId() } }, { upsert: true }); return this.col(c).findOne(f); }
}
