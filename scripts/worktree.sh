#!/usr/bin/env bash
# Worktrees de desenvolvimento do varal-panel-web (spec 01, seção 4.1).
#
#   scripts/worktree.sh new <tipo>/<descricao>   cria o worktree, o .env.local e instala dependências
#   scripts/worktree.sh list                     lista worktrees com branch, PORT_OFFSET e porta
#   scripts/worktree.sh remove <nome>            remove o worktree (recusa se houver alterações)
#
# RN-01.07: cada worktree tem um .env.local com WORKTREE_SLUG, PORT_OFFSET, PORT e a URL da API.
# RN-01.08: o painel usa a porta 3100 + PORT_OFFSET; o checkout principal usa PORT_OFFSET=0 e
#           cada worktree recebe o menor valor livre entre 1 e 99.
# RN-01.13: recusa criar worktree se core.hooksPath não apontar para .githooks.
set -euo pipefail

readonly BASE_PORT=3100
readonly DEFAULT_API_BASE_URL="http://localhost:3000"
readonly TYPES="feat fix docs refactor test perf style build ci chore"

die() {
  echo "erro: $*" >&2
  exit 1
}

usage() {
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# Raiz do checkout principal, mesmo quando o script roda de dentro de um worktree.
main_root() {
  local common_dir
  common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
  dirname "$common_dir"
}

# Lê uma variável de um arquivo .env sem executá-lo.
env_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -n 1 | tr -d '"'"'"
}

# Caminhos de todos os worktrees do clone (o primeiro é o checkout principal).
worktree_paths() {
  git worktree list --porcelain | sed -n 's/^worktree //p'
}

next_free_offset() {
  local used=" " path offset candidate
  while IFS= read -r path; do
    offset="$(env_value "$path/.env.local" PORT_OFFSET)"
    [[ -n "$offset" ]] && used+="$offset "
  done < <(worktree_paths)

  for candidate in $(seq 1 99); do
    if [[ "$used" != *" $candidate "* ]]; then
      echo "$candidate"
      return 0
    fi
  done
  die "nenhum PORT_OFFSET livre entre 1 e 99; remova worktrees antigos"
}

cmd_new() {
  local branch="${1:-}"
  [[ -n "$branch" ]] || usage 1
  [[ "$branch" =~ ^([a-z]+)/([a-z0-9]+(-[a-z0-9]+)*)$ ]] \
    || die "nome inválido: '$branch'. Use <tipo>/<descricao-com-hifens>, ex.: feat/reabrir-comanda"
  local type="${BASH_REMATCH[1]}" description="${BASH_REMATCH[2]}"
  [[ " $TYPES " == *" $type "* ]] || die "tipo '$type' inválido. Tipos: $TYPES"

  local root
  root="$(main_root)"
  cd "$root"

  local hooks_path
  hooks_path="$(git config --get core.hooksPath || true)"
  if [[ "$hooks_path" != ".githooks" ]]; then
    echo "erro: os hooks de bloqueio da main não estão ativos neste clone (RN-01.13)." >&2
    echo "Ative uma vez com:" >&2
    echo "  git -C \"$root\" config core.hooksPath .githooks" >&2
    exit 1
  fi

  local slug="${type}-${description}"
  local path="$root/.worktrees/$slug"
  [[ ! -e "$path" ]] || die "o worktree '$slug' já existe em $path"
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    die "a branch '$branch' já existe; escolha outro nome ou remova a branch antiga"
  fi

  local offset
  offset="$(next_free_offset)"
  local port=$((BASE_PORT + offset))

  echo "Atualizando origin..."
  git fetch origin
  git worktree add "$path" -b "$branch" origin/main

  cat >"$path/.env.local" <<ENV
# Gerado por scripts/worktree.sh (spec 01, seção 4.1). Não vai para o git.
WORKTREE_SLUG=$slug
PORT_OFFSET=$offset
PORT=$port
# API do checkout principal por padrão. Para testar contra a API de uma branch,
# use a porta dela: http://localhost:<3000 + PORT_OFFSET da API>.
NUXT_PUBLIC_API_BASE_URL=$DEFAULT_API_BASE_URL
ENV

  echo "Instalando dependências..."
  (cd "$path" && pnpm install)

  echo
  echo "Worktree pronto: $path"
  echo "  branch: $branch"
  echo "  PORT_OFFSET=$offset (painel em http://localhost:$port)"
  echo "  Para subir: cd \"$path\" && pnpm dev"
}

cmd_list() {
  local root path branch offset port name
  root="$(main_root)"
  printf '%-40s %-40s %-6s %s\n' "WORKTREE" "BRANCH" "OFFSET" "PORTA"
  while IFS= read -r path; do
    branch="$(git -C "$path" branch --show-current 2>/dev/null || true)"
    [[ -n "$branch" ]] || branch="(detached)"
    if [[ "$path" == "$root" ]]; then
      name="(principal)"
      offset="$(env_value "$path/.env.local" PORT_OFFSET)"
      offset="${offset:-0}"
    else
      name="${path#"$root"/.worktrees/}"
      offset="$(env_value "$path/.env.local" PORT_OFFSET)"
    fi
    if [[ -n "$offset" ]]; then
      port=$((BASE_PORT + offset))
    else
      offset="-"
      port="-"
    fi
    printf '%-40s %-40s %-6s %s\n' "$name" "$branch" "$offset" "$port"
  done < <(worktree_paths)
}

cmd_remove() {
  local name="${1:-}"
  [[ -n "$name" ]] || usage 1
  name="${name#.worktrees/}"
  [[ "$name" != */* && "$name" != "." && "$name" != ".." ]] || die "nome inválido: '$name'"

  local root path
  root="$(main_root)"
  path="$root/.worktrees/$name"
  [[ -d "$path" ]] || die "worktree não encontrado: $path"

  if [[ -n "$(git -C "$path" status --porcelain)" ]]; then
    echo "erro: o worktree '$name' tem alterações sem commit:" >&2
    git -C "$path" status --short >&2
    exit 1
  fi

  git -C "$root" worktree remove "$path"
  echo "Worktree '$name' removido. A branch continua existindo; apague-a depois do merge do PR."
}

main() {
  local command="${1:-}"
  shift || true
  case "$command" in
    new) cmd_new "$@" ;;
    list) cmd_list ;;
    remove) cmd_remove "$@" ;;
    -h | --help | help) usage 0 ;;
    *) usage 1 ;;
  esac
}

main "$@"
