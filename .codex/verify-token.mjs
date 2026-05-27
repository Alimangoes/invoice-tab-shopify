import {jwtVerify} from 'jose';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(Boolean).map(l => l.split(/=(.*)/s).slice(0,2)));
const token = process.argv[2];
const key = new Uint8Array(env.SHOPIFY_API_SECRET.length);
for (let i = 0; i < env.SHOPIFY_API_SECRET.length; i++) key[i] = env.SHOPIFY_API_SECRET.charCodeAt(i);
try {
  const verified = await jwtVerify(token, key, {algorithms:['HS256'], clockTolerance:10});
  console.log('verified', verified.payload);
} catch (error) {
  console.log(error.name + ': ' + error.message);
}
