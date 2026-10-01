#!/usr/bin/env node
// Gera app/api/schema.d.ts a partir do openapi.json do varal-web-api (RN-01.11).
//
// Origem, em ordem de prioridade:
//   1. OPENAPI_SOURCE (caminho de arquivo ou URL; usado na CI);
//   2. ../varal-web-api/openapi.json, ao lado do checkout principal deste
//      repositório (funciona também de dentro de um worktree em .worktrees/).
//
// O arquivo gerado é commitado e nunca editado à mão.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(projectRoot, 'app/api/schema.d.ts')

function defaultSource() {
  // --git-common-dir aponta para o .git do checkout principal, mesmo num worktree.
  const commonDir = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
    },
  ).trim()
  const mainCheckout = dirname(commonDir)
  return resolve(mainCheckout, '..', 'varal-web-api', 'openapi.json')
}

const source = process.env.OPENAPI_SOURCE || defaultSource()
const isUrl = /^https?:\/\//.test(source)

if (!isUrl && !existsSync(source)) {
  console.error(`openapi.json não encontrado em ${source}.`)
  console.error('Clone o varal-web-api ao lado deste repositório ou defina OPENAPI_SOURCE.')
  process.exit(1)
}

console.log(`Gerando ${output} a partir de ${source}`)
execFileSync(
  process.execPath,
  [resolve(projectRoot, 'node_modules/openapi-typescript/bin/cli.js'), source, '--output', output],
  { cwd: projectRoot, stdio: 'inherit' },
)
