import fs from 'fs';
import path from 'path';

export default async function readPostFile(filename) {
  return await fs.readFileSync(path.join(process.cwd(), "data/posts/"+filename)).toString();
}