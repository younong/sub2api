---
name: release
description: 按仓库真实的 Git tag、GitHub Actions、GoReleaser 与 Docker/systemd 部署方式执行发布检查、发布、部署、回滚和线上状态验证。
allowed-tools:
  - Read
  - Bash
---

# Sub2API 发布与部署

本 Skill 只依据仓库当前实现，不虚构额外的发布工具、服务器目录、systemd 单元或冒烟脚本。发布和服务器部署是两个阶段，必须分别确认。

## 当前仓库的发布事实

执行发布前应读取这些文件；如果实现发生变化，以文件内容为准：

- `.github/workflows/release.yml`：推送匹配 `v*` 的 Git tag 或手动 `workflow_dispatch` 后触发发布。
- `.goreleaser.yaml`：普通发布的二进制、校验文件、容器镜像和多架构 manifest。
- `.goreleaser.simple.yaml`：仅在明确选择 `simple_release` 时使用的 amd64-only GHCR 发布。
- `frontend/package.json`：前端使用 pnpm，构建脚本为 `pnpm run build`。
- `Makefile`：本地统一构建和测试入口。
- `deploy/docker-deploy.sh`：首次 Docker 部署目录准备脚本，不是升级或回滚工具。
- `deploy/docker-compose.local.yml`：生产推荐的本地目录数据存储 Compose 变体。
- `deploy/docker-compose.yml`：Docker named volume 变体。
- `deploy/docker-compose.standalone.yml`：PostgreSQL/Redis 在 Compose 外部时使用的变体。
- `deploy/install.sh`：Linux 二进制安装、升级、指定版本安装和回滚脚本。
- `deploy/sub2api.service`：二进制部署使用的 systemd 单元。

### 发布链路

1. 在已确认的发布分支上完成本地验证。
2. 创建并推送一个新的、不可变的 `vMAJOR.MINOR.PATCH`（可带合法预发布/构建后缀）tag。
3. GitHub Actions 的 `release` workflow 构建前端和后端，并运行 GoReleaser。
4. 普通发布产生多平台二进制、`checksums.txt`、GitHub Release、GHCR amd64/arm64 镜像和多架构 manifest。
5. Docker Hub 只有在仓库配置对应 secrets 时才发布，不能由 GHCR 成功推断 Docker Hub 成功。
6. `simple_release` 只产生 amd64 GHCR 镜像，不得报告为多架构发布。

发布镜像的版本使用不带 `v` 的 tag，例如 tag `v1.2.3` 对应：

```text
ghcr.io/<小写仓库 owner>/sub2api:1.2.3
```

GitHub Release/镜像发布完成后，服务器部署仍需单独执行和验证；推送 tag 不等于线上部署成功。

## 操作类型与安全边界

每次操作开始前明确说明：`release`、`release-retry`、`deploy`、`rollback` 或 `status`，并确认 tag、commit、GitHub 仓库、服务器 host/用户、部署目录和部署变体。

1. 创建/推送 tag、手动触发 workflow、拉取私有镜像、修改服务器、停止服务、升级应用和回滚都需要本次明确批准。只读状态检查不包含这些操作。
2. 不删除、移动、覆盖或强制更新已有 tag；不执行无保护的 `git push --force`。
3. 新 tag 必须来自仓库实际默认分支的已同步 commit。先检查 `git symbolic-ref refs/remotes/origin/HEAD`，不要把 `main`、`master` 或某个 fork 写死。
4. 新 tag 前必须确认工作区（含未跟踪文件）干净、`git diff --check` 通过、当前 commit 与本地/远程默认分支一致，并确认目标 tag 在本地和远端都不存在。
5. 既有 tag 只能用于重试或回滚；先核对本地与远端 tag 都解析到同一个 commit，不能删除后重建。
6. 不把 GitHub Actions、GitHub Release、GHCR、Docker Hub 和服务器部署混为一个成功状态；每一层分别报告。
7. 不读取、打印、复制或提交服务器 `.env`、registry token、数据库密码、管理员密码、cookie、模型响应或其他认证材料。不要用 `.env.example` 覆盖实际 `.env`。
8. 不执行 `docker compose down -v`、`docker volume rm`、`docker system prune`，不删除 `data/`、`postgres_data/`、`redis_data/`，不因应用升级自动重启 PostgreSQL/Redis。
9. 首次 SSH 连接前必须通过独立可信渠道核对 host fingerprint，并确认本机 `known_hosts`；不能因为文档示例而信任 host、用户、私钥或远端目录。
10. `deploy/docker-deploy.sh` 可能下载文件、生成 secrets 和覆盖部署准备文件，只能用于明确批准的首次部署；不能用于升级或回滚。

## 本地发布前检查

不自动安装或升级工具；缺少依赖时报告名称和版本。按仓库当前实现执行：

```bash
git status --short --untracked-files=all
git branch --show-current
git symbolic-ref --short refs/remotes/origin/HEAD
git fetch --no-tags origin <default-branch>
git rev-parse HEAD
git rev-parse <default-branch>
git rev-parse origin/<default-branch>
git diff --check
make test
```

如果只验证发布构建，可补充 `make build`；不要用不存在的项目入口替代仓库已有的 Makefile、pnpm、GoReleaser 和 workflow。

## 新 tag 发布

获得本次明确批准后：

1. 使用仓库实际默认分支的 commit，检查目标 tag 本地和远端均不存在。
2. 创建 annotated tag，消息包含版本和简短 release notes：

```bash
git tag -a <tag> -m '<tag>' -m '<release notes>'
```

3. 只推送精确 tag ref：

```bash
git push origin 'refs/tags/<tag>'
```

4. 记录 tag、commit、workflow URL 和 GitHub Release URL。只有 workflow 成功、GitHub Release 存在、所需 GHCR 镜像和架构均核实后，才能报告“发布产物成功”。

不要在本机用 GoReleaser 代替 GitHub Actions，也不要仅依据 tag push 成功报告发布成功。

## 既有 tag 重试

先获取并核对远端 tag：

```bash
git fetch --tags origin
git rev-parse <tag>^{commit}
git ls-remote --tags origin 'refs/tags/<tag>'
```

确认远端 tag 与目标 commit 一致后，得到本次明确批准，再手动触发 `release.yml`。不要删除或重建 tag。除非用户明确要求等待，否则不轮询 GitHub Actions；触发动作和结果必须分开报告。

## Docker Compose 部署

### 远端只读预检查

先通过独立可信渠道核对 fingerprint，再确认 host、用户和实际目录。下面的路径只是候选，不是项目事实：

```bash
ssh <user>@<host> 'docker version'
ssh <user>@<host> 'docker compose version'
ssh <user>@<host> 'test -d <deploy-dir>'
ssh <user>@<host> 'test -f <deploy-dir>/.env'
ssh <user>@<host> 'test -f <deploy-dir>/<compose-file>'
ssh <user>@<host> 'cd <deploy-dir> && docker compose --env-file .env -f <compose-file> config --quiet'
ssh <user>@<host> 'cd <deploy-dir> && docker compose --env-file .env -f <compose-file> ps'
ssh <user>@<host> 'systemctl is-active sub2api || true'
ssh <user>@<host> 'docker inspect sub2api --format "{{.Config.Image}} {{.Image}}" 2>/dev/null || true'
```

根据远端实际文件选择 `local`、named volume 或 `standalone`，不得猜测。若 `sub2api.service` active，说明可能是二进制部署；不得在同一端口启动 Compose，也不得未经单独批准停用它。

### Docker 升级

服务器实际部署目录中维护一个受限权限的 override，将应用镜像固定为已核实的版本或 digest；不要修改仓库 Compose 文件，也不要使用 `latest` 作为受控发布版本证明。

升级前：

1. 核对对应版本 GHCR 镜像和架构；私有镜像登录使用 `--password-stdin`，token 不得出现在参数或日志中。
2. 记录现有应用镜像和 digest，不输出 `.env`。
3. 对 Compose 内置 PostgreSQL 做非空、受限权限的备份；standalone 部署使用其已批准的外部数据库备份机制。
4. 生成并校验新的 override，再拉取应用镜像；成功后原子替换正式 override，并保留旧版本以便回滚。
5. 只重建应用服务，例如 `docker compose ... up -d --no-deps --force-recreate sub2api`，不重启数据库/Redis。

升级后必须检查：

- Compose 中应用服务为运行状态且使用请求的版本/digest；
- 容器 health 状态为 `healthy`；
- PostgreSQL/Redis（适用时）可用；
- 根据实际宿主端口访问 `/health`；
- 最近应用日志没有致命启动或迁移错误。

应用迁移是 forward-only；镜像回滚不会自动撤销 schema/data 变化。数据库恢复是独立的破坏性操作，必须单独批准，不能因应用 unhealthy 自动执行。

## 二进制 systemd 部署

项目现有二进制安装目录和服务事实来自 `deploy/install.sh`、`deploy/sub2api.service`：

- 默认二进制目录：`/opt/sub2api`；
- 服务名：`sub2api`；
- 服务工作目录：`/opt/sub2api`；
- 配置目录：`/etc/sub2api`；
- 服务入口：`/opt/sub2api/sub2api`。

只读检查：

```bash
ssh <user>@<host> 'systemctl is-active sub2api || true'
ssh <user>@<host> 'systemctl status --no-pager sub2api'
ssh <user>@<host> 'test -x /opt/sub2api/sub2api'
ssh <user>@<host> '/opt/sub2api/sub2api --version 2>/dev/null || true'
ssh <user>@<host> 'journalctl -u sub2api --since "10 min ago" --no-pager -n 100'
```

升级/指定版本安装使用仓库已有的 `deploy/install.sh` 参数约定：`upgrade`、`upgrade -v <version>`、`rollback <version>`。它会停止服务、保存旧二进制备份、从 GitHub Release 下载并尝试启动新版本；每次都需先备份并在升级后检查 service 状态、版本、端口和日志。回滚不会自动回退数据库迁移。

## 回滚

- Docker：使用已核实的上一稳定版本或 digest，保留失败版本和旧 override；按升级前备份、override 校验、只重建应用和全套健康检查流程执行。
- systemd：使用 `deploy/install.sh rollback <version>` 或等价的 `install -v <version>`，前提是目标 GitHub Release 存在且版本已核实。
- 不删除失败 tag、失败镜像或备份；不自动恢复数据库。

## 服务器状态检查与报告

用户只要求状态时，只执行匹配实际部署变体的只读命令。报告必须包含：

- host、用户、实际部署目录和 Compose 变体（或 systemd 服务名）；
- 当前应用 image/digest 或二进制版本；
- 应用、PostgreSQL、Redis 状态（适用时）；
- health endpoint、最近有限日志的结论；
- 是否执行过服务器写操作（只读检查应明确为“未修改服务器”）。

不得把路径示例当作检查结果，不得输出 `.env`、认证信息、完整敏感日志或模型响应。

## 已验证服务器观测值（2026-09-01）

以下是一次只读检查的观测记录，不代表永久配置；以后执行操作前仍需重新检查：

- SSH 目标：`root@106.15.186.104`；本机已存在并匹配该目标的 known_hosts 记录，使用本机 SSH key，不在文档中保存私钥内容。
- Docker Server：`26.1.3`；Docker Compose：`v2.27.0`。
- 实际部署目录：`/opt/sub2api`；实际环境文件存在但未读取内容。
- 实际 Compose 文件：`/opt/sub2api/docker-compose.yml`；`docker compose ... config --quiet` 通过。
- 运行服务：`sub2api`、`sub2api-postgres`、`sub2api-redis` 均为 healthy；另有 `searxng` 容器运行。
- 应用镜像：`ghcr.io/wei-shaw/sub2api:0.1.183`；检查到 digest，容器状态为 running/healthy。
- 应用宿主端口：`127.0.0.1:8081`；访问 `http://127.0.0.1:8081/health` 成功。
- 挂载检查显示应用、PostgreSQL 和 Redis 使用 `/opt/sub2api` 下的持久化目录（PostgreSQL 同时存在镜像声明的 volume）；该运行态按数据挂载表现为本地目录持久化，不应仅凭 Compose 文件名猜测变体。
- `sub2api.service` 当前不是 active，因此本次运行不是 active 的 legacy systemd 服务。

检查过程未执行 pull、up、stop、restart、数据库操作、模型调用或其他服务器写操作；未输出 `.env`、认证材料或日志原文。后续部署仍须针对当前镜像版本、digest、端口和挂载重新做只读预检查。
