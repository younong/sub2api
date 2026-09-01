---
name: release
description: Sub2API 的 Git tag/GitHub Actions 容器发布，以及 Docker Compose 部署、状态检查和回滚流程；用户要求发布、部署、打 tag、回滚或查看 sub2api 线上状态时使用。
allowed-tools:
  - Read
  - Bash
---

# Sub2API 发布与部署

本 skill 只描述当前 Sub2API 项目已有的发布和部署方式：Git tag 触发 GitHub Actions，GitHub Actions 通过 GoReleaser 发布容器镜像，服务器使用 Docker Compose。发布镜像不会自动部署到服务器；发布和部署是两个需要分别确认的操作。

## 项目事实与术语

发布入口和镜像规则来自仓库当前文件，执行前必须读取它们：

- `.github/workflows/release.yml`：推送 `v*` tag 或手动 `workflow_dispatch` 后构建发布。
- `.goreleaser.yaml`：构建产物、镜像架构和镜像命名。
- `.goreleaser.simple.yaml`：只有用户明确选择 `simple_release` 时读取。
- `deploy/docker-compose.local.yml`：推荐的生产部署，数据位于 `data/`、`postgres_data/`、`redis_data/`。
- `deploy/docker-compose.yml`：使用 Docker named volumes 的部署。
- `deploy/docker-compose.standalone.yml`：PostgreSQL 和 Redis 在 Compose 外部时使用。
- `deploy/.env.example`：环境变量模板；服务器实际 `.env` 不能被覆盖或打印。
- `deploy/docker-deploy.sh`：首次准备部署目录的脚本，不是升级工具。
- `deploy/sub2api.service`：仅当服务器检测到 legacy systemd 二进制部署时读取。

推送 tag `v1.2.3` 后，GoReleaser 的 `.Version` 为 `1.2.3`，因此标准 GHCR 镜像是：

```text
ghcr.io/<小写仓库所有者>/sub2api:1.2.3
```

完整发布通常还包含同一镜像的 `amd64` 和 `arm64` manifest。Docker Hub 镜像只有在仓库配置了 `DOCKERHUB_USERNAME` 时才存在，不能默认假设它可用。

Compose 应用服务名是 `sub2api`，依赖服务是 `postgres` 和 `redis`。容器监听 `8080`，宿主机端口由 `${SERVER_PORT:-8080}` 决定，应用健康检查为 `/health`。Compose 文件当前将默认镜像写为 `weishaw/sub2api:latest`；受控发布不得使用 `latest`，部署时应通过部署目录内的 override 固定版本镜像。

## 执行前的安全规则

1. 创建或推送 tag、运行 `workflow_dispatch`、修改远端服务器、停止 legacy systemd 服务、恢复数据库，都必须得到本次操作的明确批准。用户只说“查看状态”时只能执行只读检查。
2. 不重打、删除或强制更新已有 tag；不运行 `git push --force`。
3. 受控发布或回滚禁止部署 `latest`，必须使用明确版本或 digest。
4. 不打印、读取后复述或复制服务器 `.env`、registry token、数据库密码、管理员密码、cookie 或其他认证材料。不得用 `.env.example` 覆盖现有 `.env`。
5. 禁止执行 `docker compose down -v`、`docker volume rm`、`docker system prune`，以及删除 `data/`、`postgres_data/`、`redis_data/`。
6. 应用镜像升级不要重启 PostgreSQL 或 Redis。新版本可能包含数据库迁移；升级前先做 PostgreSQL 备份。Sub2API 迁移是 forward-only，镜像回滚不会自动撤销 schema 或数据变化。
7. `deploy/docker-deploy.sh` 会准备初始文件并生成凭据，可能覆盖目录中的部署文件；不要用它做升级或回滚。
8. 首次连接服务器前，通过独立可信渠道核对 SSH host fingerprint。不要无条件假设 host、SSH 用户、私钥路径或远端目录。`/opt/sub2api/deploy` 只能作为建议路径，必须先检查并让用户确认实际值。
9. 不以项目中不存在的发布脚本、服务名、冒烟脚本或 systemd 单元作为操作依据；所有命令以当前仓库文件和服务器实际检查结果为准。

## 必须先确认的输入

在执行写操作前，列出并确认：

- 操作类型：`release`、`deploy`、`release-and-deploy`、`status` 或 `rollback`。
- tag 和对应 commit；新 tag 使用 `vMAJOR.MINOR.PATCH`（可带预发布/构建后缀）。
- GitHub 仓库及小写 owner；不要把组织名或 fork 名称写死。
- SSH host、用户和认证方式。
- 远端 Docker 部署目录以及实际 Compose 变体：`local`、named volumes 或 `standalone`。
- 是首次部署、应用升级还是回滚；现在线上 image 和 digest。
- 回滚时的上一稳定版本或已核实 digest。

## 发布到镜像仓库

### 本地发布前检查

使用仓库默认分支，不把 `main` 等某个分支名硬编码为事实。先读取默认分支并执行：

```bash
git status --short
git branch --show-current
git remote -v
git fetch origin --tags
DEFAULT_BRANCH="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
test -n "$DEFAULT_BRANCH"
git rev-parse HEAD
git rev-parse "origin/$DEFAULT_BRANCH"
git tag --list "$TAG"
git ls-remote --tags origin "refs/tags/$TAG"
gh repo view --json nameWithOwner,defaultBranchRef
```

正常新发布必须满足：

- 工作区干净，包含未跟踪文件检查结果；
- 当前 commit 与远端默认分支一致；
- tag 在本地和远端都不存在；
- tag 符合版本格式，且不会指向另一个已有 commit。

运行仓库已有的本地验证（例如仓库提供的 `make test`），不自动安装或升级依赖。缺少工具或依赖时报告具体缺失项，先征得用户同意再安装；不要用不存在的 Node 发布脚本替代验证。

### 创建并推送新 tag

得到本次明确批准后，使用 annotated tag：

```bash
git tag -a "$TAG" -m "$TAG" -m "<release notes>"
git push origin "refs/tags/$TAG"
```

不要在本机运行 GoReleaser 代替 CI。推送 tag 是当前仓库的正式发布入口。

### 验证 GitHub Release 和镜像

识别刚刚触发的 workflow，并等待其进入终态；这是为了确认部署所需的版本镜像已经存在：

```bash
gh run list --workflow release.yml --limit 5 \
  --json databaseId,status,conclusion,url,headSha,displayTitle
# 仅在用户允许等待 CI 时：
gh run watch <run-id> --exit-status
gh release view "$TAG"
```

动态计算仓库 owner 和镜像版本，不能硬编码当前 fork：

```bash
REPOSITORY="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
OWNER="${REPOSITORY%%/*}"
OWNER_LOWER="$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]')"
VERSION="${TAG#v}"
IMAGE="ghcr.io/${OWNER_LOWER}/sub2api:${VERSION}"
docker buildx imagetools inspect "$IMAGE"
```

只有以下条件全部满足，才报告镜像发布成功：

- 对应 `release.yml` workflow 成功；
- `gh release view "$TAG"` 找到 GitHub Release；
- 精确版本 GHCR 镜像可 inspect；
- 镜像架构符合服务器（普通发布通常为多架构；`simple_release=true` 仅允许按 workflow 实际产物报告 amd64）。

Docker Hub 是可选结果，必须单独核实，不能用 GHCR 成功推断 Docker Hub 成功。

### 已有 tag 的重试

已有 tag 只能在验证远端 tag 与目标 commit 一致后重跑 workflow，不得删除后重建：

```bash
git fetch origin --tags
git rev-parse "$TAG^{commit}"
git ls-remote --tags origin "refs/tags/$TAG"
```

得到明确批准后：

```bash
gh workflow run release.yml -f tag="$TAG" -f simple_release=false
```

## Docker Compose 远端部署

### 远端只读预检查

先确认 host、用户和实际目录，再执行只读检查。下面的 `/opt/sub2api/deploy` 只是示例，必须替换为已确认路径：

```bash
ssh <user>@<host> 'docker version'
ssh <user>@<host> 'docker compose version'
ssh <user>@<host> 'test -d /opt/sub2api/deploy'
ssh <user>@<host> 'test -f /opt/sub2api/deploy/.env'
ssh <user>@<host> 'test -f /opt/sub2api/deploy/docker-compose.local.yml'
ssh <user>@<host> 'cd /opt/sub2api/deploy && docker compose --env-file .env -f docker-compose.local.yml config --quiet'
ssh <user>@<host> 'cd /opt/sub2api/deploy && docker compose --env-file .env -f docker-compose.local.yml ps'
ssh <user>@<host> 'systemctl is-active sub2api || true'
ssh <user>@<host> 'docker inspect sub2api --format "{{.Config.Image}} {{.Image}}" 2>/dev/null || true'
```

如果 `sub2api.service` 处于 active，说明服务器可能是 legacy 二进制部署。不得在同一端口启动 Compose，也不得无单独批准停用该服务。若服务器实际使用 named volumes 或 standalone，所有后续命令都必须换成检测到的 Compose 文件和相应备份方式。

私有 GHCR 镜像需要在服务器登录时使用 stdin，token 不得放在命令参数或最终报告中：

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USER" --password-stdin
```

### 用 deployment-local override 固定镜像

不要修改仓库中的 Compose 文件。因为它们默认使用 `latest`，在部署目录维护 `docker-compose.release.yml`，内容只覆盖应用镜像：

```yaml
services:
  sub2api:
    image: "ghcr.io/<小写 owner>/sub2api:<version>"
```

先生成临时文件、校验并拉取，成功后再激活：

```bash
cd /opt/sub2api/deploy
umask 077
printf 'services:\n  sub2api:\n    image: "%s"\n' \
  "ghcr.io/<小写 owner>/sub2api:<version>" \
  > docker-compose.release.yml.next

docker compose --env-file .env \
  -f docker-compose.local.yml -f docker-compose.release.yml.next \
  config --quiet

docker compose --env-file .env \
  -f docker-compose.local.yml -f docker-compose.release.yml.next \
  pull sub2api
```

拉取成功后保留旧 override，再原子替换：

```bash
if test -f docker-compose.release.yml; then
  cp -p docker-compose.release.yml docker-compose.release.yml.previous
fi
mv docker-compose.release.yml.next docker-compose.release.yml
```

### 备份并只更新应用容器

部署前记录旧 image 和 digest，不输出环境变量：

```bash
docker inspect sub2api --format '{{.Config.Image}} {{.Image}}'
docker image inspect "$(docker inspect sub2api --format '{{.Image}}')" \
  --format '{{json .RepoDigests}}'
```

对包含 Compose 内 PostgreSQL 的部署，创建受限且非空的备份：

```bash
cd /opt/sub2api/deploy
umask 077
mkdir -p backups
VERSION="<version-without-v>"
BACKUP_FILE="backups/postgres-pre-${VERSION}-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file .env -f docker-compose.local.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$BACKUP_FILE"
test -s "$BACKUP_FILE"
```

实际文件名应从命令结果中记录，不能在报告中暴露内容。standalone 部署使用外部数据库的已批准备份机制，不要假设有 `postgres` 服务。

得到远端部署明确批准后，只重建 `sub2api`：

```bash
cd /opt/sub2api/deploy
docker compose --env-file .env \
  -f docker-compose.local.yml -f docker-compose.release.yml \
  up -d --no-deps --force-recreate sub2api
```

不得执行 `docker compose down`，不得因应用发布重启 PostgreSQL 或 Redis。若本次发布要改数据库或 Redis 配置，按独立基础设施变更重新确认。

## 发布后验证

先确认活动镜像和 Compose 状态：

```bash
cd /opt/sub2api/deploy
docker compose --env-file .env \
  -f docker-compose.local.yml -f docker-compose.release.yml ps
docker inspect sub2api --format '{{.Config.Image}} {{.Image}}'
```

使用有上限的轮询等待健康状态，同时覆盖失败状态：

```bash
status=''
for attempt in $(seq 1 30); do
  status="$(docker inspect sub2api --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
  test "$status" = healthy && break
  test "$status" = exited -o "$status" = dead && break
  sleep 2
done
test "$status" = healthy
```

验证依赖和实际宿主端口：

```bash
docker compose --env-file .env \
  -f docker-compose.local.yml -f docker-compose.release.yml \
  exec -T postgres pg_isready
docker compose --env-file .env \
  -f docker-compose.local.yml -f docker-compose.release.yml \
  exec -T redis redis-cli ping

HOST_PORT="$(docker inspect sub2api \
  --format '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}')"
curl --fail --silent --show-error "http://127.0.0.1:${HOST_PORT}/health"

docker compose --env-file .env \
  -f docker-compose.local.yml -f docker-compose.release.yml \
  logs --since=10m --tail=200 sub2api
```

只有活动容器指向请求的版本或 digest、容器为 healthy、`/health` 成功、适用的 PostgreSQL/Redis 检查成功且最近日志无致命启动/迁移错误时，才能报告部署成功。不要虚构额外的 authenticated smoke 或 WebSocket 检查。

## 回滚

### 应用镜像回滚

回滚使用明确的上一稳定版本或 digest，不能使用 `latest`：

```bash
PREVIOUS_IMAGE='ghcr.io/<小写 owner>/sub2api:<previous-version>'
# 已知 digest 时优先：ghcr.io/<小写 owner>/sub2api@sha256:<digest>
```

使用与部署相同的 `.next` 生成、`config --quiet`、pull、备份旧 override、替换 override、仅重建 `sub2api` 和全套健康验证流程。失败 tag 和镜像必须保留，不得删除。可将当前失败 override 保存为 `docker-compose.release.yml.failed`，以便审计和再次处理。

### 数据库恢复

明确告知用户：迁移是 forward-only，回滚镜像不回滚 schema/data。只有旧应用与新 schema 不兼容时才考虑恢复数据库；这是停机和破坏性操作，必须单独批准，skill 不得自动执行。批准后高层顺序为：

1. 先为当前失败状态再保存一个备份；
2. 只停止 `sub2api`；
3. 恢复已核实且获批准的 dump；
4. 启动旧版本镜像；
5. 重做全部健康、依赖、端口和日志验证。

`pg_restore --clean --if-exists` 会破坏现有数据库，只能在单独批准后使用，不能因为容器 unhealthy 就自动运行。

## 只读状态检查

用户只要求查看线上状态时，只运行与实际 Compose 变体匹配的只读命令：

```bash
cd /opt/sub2api/deploy
docker compose --env-file .env \
  -f docker-compose.local.yml -f docker-compose.release.yml ps
docker inspect sub2api --format \
  'image={{.Config.Image}} id={{.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'
docker compose --env-file .env \
  -f docker-compose.local.yml -f docker-compose.release.yml \
  logs --since=10m --tail=200 sub2api
systemctl is-active sub2api || true
```

不要把 `docker compose config` 的环境展开结果、`.env` 内容或日志中的凭据复制到回复中。

## 最终报告

每次操作结束时报告：

- 操作类型、tag、关联 commit；
- workflow URL/结论和 GitHub Release URL（若执行了发布）；
- 精确 image reference/digest，以及普通或 simple release；
- 已确认的 SSH target、部署目录和 Compose 变体；
- 部署前旧 image/digest 和 PostgreSQL 备份路径/非空校验结果；
- `sub2api`、PostgreSQL、Redis 状态，健康检查和实际宿主端口；
- 是否真的修改服务器、是否回滚；
- 失败发生在哪一步，以及是否已经部分提交。

绝不报告 `.env`、registry token、数据库/管理员密码、cookie、ticket、模型回复或其他认证材料。dry-run 或只读操作必须明确标记为未修改服务器。
