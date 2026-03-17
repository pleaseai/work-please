import { join } from 'node:path'
import { file, write } from 'bun'

const distFile = join(import.meta.dir, '../dist/index.js')
const content = await file(distFile).text()
await write(distFile, `#!/usr/bin/env bun\n${content}`)
