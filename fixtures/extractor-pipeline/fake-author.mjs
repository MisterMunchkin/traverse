// Offline test double consumes only the handoff; it is not an LLM.
import fs from 'node:fs';
const {request} = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(request.requirements.artifactTemplate));
