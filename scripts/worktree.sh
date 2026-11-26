#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/worktree.sh create <slug> [prefix] [--no-bootstrap]
  scripts/worktree.sh list
  scripts/worktree.sh remove <slug> [--force]

Commands:
  create <slug> [prefix] [--no-bootstrap]
      Create .worktrees/<slug> on branch <prefix>/<slug> (default prefix: feat)
      from main, and bootstrap isolated backend/.venv (uv sync) and
      frontend/node_modules (npm ci) unless --no-bootstrap is passed.
  list
      List all active git worktrees.
  remove <slug> [--force]
      Remove .worktrees/<slug> and delete its local branch. Without --force,
      refuses if the worktree has uncommitted changes or unmerged commits.
EOF
}

resolve_main_root() {
  local common_dir
  common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || {
    echo "Error: must be run inside a git repository." >&2
    exit 1
  }
  common_dir="$(cd "$common_dir" && pwd)"
  dirname "$common_dir"
}

validate_identifier() {
  local label="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo "Error: invalid ${label} '${value}'. Use lowercase alphanumeric characters, '-' or '_' starting with [a-z0-9]." >&2
    exit 1
  fi
}

cmd_create() {
  local slug=""
  local prefix="feat"
  local prefix_set=0
  local bootstrap=1

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-bootstrap)
        bootstrap=0
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      -*)
        echo "Error: unknown option '$1' for create." >&2
        usage >&2
        exit 1
        ;;
      *)
        if [[ -z "$slug" ]]; then
          slug="$1"
        elif [[ "$prefix_set" -eq 0 ]]; then
          prefix="$1"
          prefix_set=1
        else
          echo "Error: unexpected argument '$1'." >&2
          usage >&2
          exit 1
        fi
        shift
        ;;
    esac
  done

  if [[ -z "$slug" ]]; then
    echo "Error: missing <slug>." >&2
    usage >&2
    exit 1
  fi

  validate_identifier "slug" "$slug"
  validate_identifier "prefix" "$prefix"

  local main_root wt_dir branch
  main_root="$(resolve_main_root)"
  wt_dir="${main_root}/.worktrees/${slug}"
  branch="${prefix}/${slug}"

  if [[ -e "$wt_dir" ]]; then
    echo "Error: worktree path already exists: ${wt_dir}" >&2
    exit 1
  fi
  if ! git -C "$main_root" show-ref --verify --quiet "refs/heads/main"; then
    echo "Error: base branch 'main' does not exist." >&2
    exit 1
  fi
  if git -C "$main_root" show-ref --verify --quiet "refs/heads/${branch}"; then
    echo "Error: branch '${branch}' already exists." >&2
    exit 1
  fi

  if [[ "$bootstrap" -eq 1 ]]; then
    command -v uv >/dev/null 2>&1 || {
      echo "Error: 'uv' not found on PATH." >&2
      exit 1
    }
    command -v npm >/dev/null 2>&1 || {
      echo "Error: 'npm' not found on PATH." >&2
      exit 1
    }
  fi

  mkdir -p "${main_root}/.worktrees"
  git -C "$main_root" worktree add -b "$branch" "$wt_dir" main

  if [[ "$bootstrap" -eq 1 ]]; then
    echo "Bootstrapping isolated backend/.venv via uv sync..."
    (cd "${wt_dir}/backend" && env -u VIRTUAL_ENV uv sync --all-extras --frozen)
    echo "Bootstrapping isolated frontend/node_modules via npm ci..."
    npm --prefix "${wt_dir}/frontend" ci
  fi

  local base_sha
  base_sha="$(git -C "$wt_dir" rev-parse --short HEAD)"
  echo "Created worktree:"
  echo "  Path:   ${wt_dir}"
  echo "  Branch: ${branch}"
  echo "  Base:   main (${base_sha})"
}

cmd_list() {
  if [[ $# -gt 0 ]]; then
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Error: unexpected argument '$1' for list." >&2
        usage >&2
        exit 1
        ;;
    esac
  fi

  local main_root
  main_root="$(resolve_main_root)"
  git -C "$main_root" worktree list
}

cmd_remove() {
  local slug=""
  local force=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force)
        force=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      -*)
        echo "Error: unknown option '$1' for remove." >&2
        usage >&2
        exit 1
        ;;
      *)
        if [[ -z "$slug" ]]; then
          slug="$1"
        else
          echo "Error: unexpected argument '$1'." >&2
          usage >&2
          exit 1
        fi
        shift
        ;;
    esac
  done

  if [[ -z "$slug" ]]; then
    echo "Error: missing <slug>." >&2
    usage >&2
    exit 1
  fi

  validate_identifier "slug" "$slug"

  local main_root wt_dir branch
  main_root="$(resolve_main_root)"
  wt_dir="${main_root}/.worktrees/${slug}"

  if [[ ! -d "$wt_dir" ]]; then
    echo "Error: worktree does not exist: ${wt_dir}" >&2
    exit 1
  fi

  branch="$(git -C "$wt_dir" branch --show-current 2>/dev/null || true)"
  if [[ "$branch" == "main" ]]; then
    echo "Error: refusing to remove a worktree checked out on 'main'." >&2
    exit 1
  fi

  if [[ "$force" -eq 0 ]]; then
    if [[ -n "$(git -C "$wt_dir" status --porcelain)" ]]; then
      echo "Error: worktree '${wt_dir}' has uncommitted changes. Commit, stash, or pass --force." >&2
      exit 1
    fi
    if [[ -n "$branch" ]] && ! git -C "$main_root" merge-base --is-ancestor "$branch" main; then
      echo "Error: branch '${branch}' is not merged into 'main'. Merge first or pass --force." >&2
      exit 1
    fi
  fi

  if [[ "$force" -eq 1 ]]; then
    git -C "$main_root" worktree remove --force "$wt_dir"
  else
    git -C "$main_root" worktree remove "$wt_dir"
  fi

  if [[ -n "$branch" ]] && git -C "$main_root" show-ref --verify --quiet "refs/heads/${branch}"; then
    if [[ "$force" -eq 1 ]]; then
      git -C "$main_root" branch -D "$branch"
    else
      git -C "$main_root" branch -d "$branch"
    fi
  fi

  git -C "$main_root" worktree prune
  echo "Removed worktree '${wt_dir}'${branch:+ and deleted branch '${branch}'}."
}

main() {
  if [[ $# -eq 0 ]]; then
    usage >&2
    exit 1
  fi

  local subcmd="$1"
  shift

  case "$subcmd" in
    create)
      cmd_create "$@"
      ;;
    list)
      cmd_list "$@"
      ;;
    remove)
      cmd_remove "$@"
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Error: unknown command '${subcmd}'." >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
