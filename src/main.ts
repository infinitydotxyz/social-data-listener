import { config as loadEnv } from 'dotenv';
import { startServices } from './services';
import { writer as write } from './writer';
import { firestore } from './container';

// Load environment vars
loadEnv();

void main();

async function main() {
  await startServices((event) => write(event, firestore));
}
