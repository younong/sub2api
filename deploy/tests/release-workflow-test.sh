#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

workflow=.github/workflows/release.yml
server_config=.goreleaser.simple.yaml
full_config=.goreleaser.yaml

fail() {
  printf 'release workflow test failed: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  file=$1
  text=$2
  grep -Fq -- "$text" "$file" || fail "$file is missing: $text"
}

assert_not_contains() {
  file=$1
  text=$2
  if grep -Fq -- "$text" "$file"; then
    fail "$file must not contain: $text"
  fi
}

assert_contains "$workflow" "mode=server-only"
assert_contains "$workflow" "mode=full"
assert_contains "$workflow" "confirm_full:"
assert_contains "$workflow" "Full releases require a stable vMAJOR.MINOR.PATCH tag"
assert_contains "$workflow" "args: release --clean --config=.goreleaser.simple.yaml"
assert_contains "$workflow" "args: release --clean --config=.goreleaser.yaml"
assert_contains "$workflow" "steps.prepare.outputs.mode == 'full'"
assert_contains "$workflow" "steps.prepare.outputs.mode == 'server-only'"
assert_contains "$workflow" "needs.release.outputs.stable == 'true'"
assert_contains "$workflow" "pnpm install --frozen-lockfile --prefer-offline"
assert_contains "$workflow" "pnpm run build"
assert_contains "$workflow" 'delimiter="TAG_MESSAGE_$(openssl rand -hex 16)"'
assert_contains "$workflow" 'if [ -z "$remote_refs" ]; then'
assert_not_contains "$workflow" "Retry tag is missing"
assert_not_contains "$workflow" "SIMPLE_RELEASE"
assert_not_contains "$workflow" "simple_release"
assert_not_contains "$workflow" "--skip=validate"
assert_not_contains "$workflow" "actions/upload-artifact"
assert_not_contains "$workflow" "actions/download-artifact"
assert_not_contains "$workflow" "tag_message<<EOF"
assert_not_contains "$workflow" 'TAG_MESSAGE='"'"'${{'

assert_contains "$server_config" "      - linux"
assert_contains "$server_config" "      - amd64"
assert_not_contains "$server_config" "      - arm64"
assert_contains "$server_config" "      - -tags=embed"
assert_contains "$server_config" "      - -X main.Version={{ .Version }}"
assert_contains "$server_config" "archives: []"
assert_contains "$server_config" "  disable: true"
assert_contains "$server_config" "  skip_upload: true"
assert_contains "$server_config" "      - backend/resources"
assert_contains "$server_config" "      - deploy/docker-entrypoint.sh"
assert_contains "$server_config" "--cache-from=type=gha,scope=sub2api-server-amd64"
assert_contains "$server_config" "--cache-to=type=gha,mode=max,scope=sub2api-server-amd64"
assert_contains "$server_config" 'skip_push: '"'"'{{ if eq .Env.IS_STABLE "true" }}false{{ else }}true{{ end }}'"'"
assert_contains "$server_config" "(Server-only)"
assert_not_contains "$server_config" "go mod tidy"
assert_not_contains "$server_config" "checksums.txt"

assert_contains "$full_config" "      - -X main.Version={{ .Version }}"
assert_contains "$full_config" "      - windows"
assert_contains "$full_config" "      - darwin"
assert_contains "$full_config" "      - arm64"
assert_contains "$full_config" "  name_template: 'checksums.txt'"

semver_script=$(mktemp "${TMPDIR:-/tmp}/sub2api-semver.XXXXXX")
trap 'rm -f "$semver_script"' EXIT HUP INT TERM
sed -n '/^          validate_semver() {$/,/^          }$/p' "$workflow" | \
  sed 's/^          //' > "$semver_script"
cat >> "$semver_script" <<'EOF'
for version in v0.0.0 v1.2.3 v1.2.3-test.1 v10.20.30-rc.0 v1.2.3-alpha-beta; do
  validate_semver "$version" || exit 10
done
for version in 1.2.3 v01.2.3 v1.02.3 v1.2.03 v12x.2.3 v1.2x.3 v1.2.3x v1.2.3+build v1.2.3-01 v1.2.3- v1.2.3-.rc v1.2.3-rc. v1.2.3-rc..1; do
  if validate_semver "$version"; then
    exit 11
  fi
done
EOF
bash "$semver_script" || fail 'embedded SemVer validation behavior is incorrect'

printf 'release workflow test passed\n'
