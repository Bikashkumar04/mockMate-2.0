import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE;

if (!uri) {
  throw new Error("MONGODB_URI is not set");
}

if (!dbName) {
  throw new Error("MONGODB_DATABASE is not set");
}

const mongoUri = uri;
const mongoDatabase = dbName;

let client: MongoClient | undefined;

export function getMongoClient() {
  if (!client) {
    client = new MongoClient(mongoUri);
  }
  return client;
}

export function getMongoDb() {
  return getMongoClient().db(mongoDatabase);
}
