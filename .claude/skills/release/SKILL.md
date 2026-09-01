---
name: release
description: 按仓库真实的 Git tag、GitHub Actions、GoReleaser 与 Docker/systemd 部署方式执行发布检查、发布、部署、回滚和线上状态验证；用户要求发布、部署、打 tag、回滚或查看 sub2api 线上状态时使用。
allowed-tools:
  - Read
  - Bash
---

# Sub2API 发布与部署

本 Skill 只依据仓库当前实现，不虚构额外的发布工具、服务器目录、systemd 单元或冒烟脚本。发布产物和服务器部署是两个阶段，必须分别批准、执行和报告。

## 当前发布模型

执行前读取当前文件；如果实现变化，以代码为准：

- `.github/workflows/release.yml`：普通 `v*` tag push 固定触发 server-only；手动 `workflow_dispatch` 专用于 full。
- `.goreleaser.simple.yaml`：server-only，构建嵌入 Web UI 的 Linux amd64 GHCR 镜像并创建 GitHub Release 页面，不上传 binary assets。
- `.goreleaser.yaml`：full，保留多平台 binaries、archives、`checksums.txt`、amd64/arm64 容器、多架构 manifest、GHCR 和可选 Docker Hub。
- `frontend/package.json` 与 `backend/internal/web/embed_on.go`：前端必须在 GoReleaser 前真实构建，不能因为 server-only 而跳过。
- `Dockerfile.goreleaser`：镜像需要 PostgreSQL client、`backend/resources` 和 `deploy/docker-entrypoint.sh`，不得当成多余产物删除。
- `deploy/install.sh` 与应用 update/rollback service：依赖 full GitHub Release 的 archives 和 checksum；server-only 与该更新路径不兼容。
- `deploy/apple-container.sh`：依赖 full 的 Linux arm64 镜像。

### Server-only 默认发布

推送一个新的 annotated `vMAJOR.MINOR.PATCH[-PRERELEASE]` tag 后固定执行 server-only：

- 只构建 `linux/amd64`；
- 发布 `ghcr.io/<小写 owner>/sub2api:<version>-amd64` 和 `:<version>`；
- 稳定版额外更新 `:latest`，test/rc prerelease 不得更新 `latest`；
- 创建 GitHub Release；prerelease 自动标记为 prerelease；
- Release 页面没有二进制、archive 或 checksum assets；
- 不执行 QEMU、arm64、多架构 manifest、Docker Hub、Telegram；
- 成功的稳定版同步默认分支 `backend/cmd/server/VERSION`，prerelease 不同步。

Server-only 是当前 Linux amd64 Docker Compose 服务器的默认产物。不得将它报告为多架构、二进制或 Docker Hub 发布。

### 手动 full 发布

Full 只用于一个尚不存在的新稳定 `vMAJOR.MINOR.PATCH` tag：

1. 从远程默认分支当前 HEAD 手动 dispatch `release.yml`；
2. 输入新 tag、release notes 并显式确认 full；
3. workflow 验证默认分支 HEAD、tag 和 Release 后自行创建并推送 annotated tag；
4. 该 tag 由 `GITHUB_TOKEN` 推送，不会递归触发 server-only；
5. workflow 运行 `.goreleaser.yaml`，保留 installer、应用 updater/rollback、Windows、macOS、Linux arm64、Apple Container、Docker Hub 和多平台文档所需产物。

不要先在本地创建或推送 full tag，否则普通 tag push 会先启动 server-only。已经成功发布 server-only 的同 tag 不得补做 full；tag 不删除、不重建、不覆盖、不强制更新。

### 重试语义

- server-only 失败：从原 tag-push run 使用 “Re-run failed jobs”；不改成 full。
- full 失败：重跑原 workflow run；不要重新 dispatch 同 tag。
- 重试前核对远端 tag 仍解析到原 commit。
- 已存在的 tag 仅用于原 run 重试或回滚，不能作为新发布入口。

## 已确认的线上连接与部署信息

- SSH host：`106.15.186.104`
- SSH user：`root`
- SSH identity file：`~/.ssh/hermes_apiyi_ed25519`
- 实际部署目录：`/opt/sub2api`
- Compose 项目：`sub2api`；基础文件：`/opt/sub2api/docker-compose.yml`
- 受控镜像 override：`/opt/sub2api/docker-compose.release.yml`
- 实际部署变体：应用、PostgreSQL 和 Redis 使用宿主机本地目录 bind mount（`data`、`postgres_data`、`redis_data`）；不得仅按 Compose 文件名推断变体。
- 应用宿主端口：`127.0.0.1:8081` 到容器 `8080`；健康端点：`http://127.0.0.1:8081/health`
- systemd `sub2api` 最近核验为 inactive；线上应用由 Docker Compose 管理，不得在同一端口启动二进制服务。
- Host fingerprint 不写入仓库；首次连接前通过独立可信来源核对 fingerprint 并确认本机 `known_hosts`。
- identity file 只能作为 SSH `-i` 参数使用，不得读取、打印或提交私钥内容。

### 最近一次生产部署核验（2026-09-01）

- Docker Engine `26.1.3`、Docker Compose `v2.27.0`。
- 应用镜像固定为 `ghcr.io/younong/sub2api@sha256:dfdd1ca41bd4eaa02399af2de93c534572e6ac7b92872ac30e9d8083d9b63a8e`。
- 容器版本标签：`0.1.186-test.1`；revision：`58c807f168f29b849cbdb928f8a22a9d230de809`。
- 上一镜像仍保留用于回滚：`sha256:bf749809905f377658ae8c132a80c8e09f5ea162f1c36d5ddfe40459b108b5e9`。
- 部署前 PostgreSQL backup：`/opt/sub2api/backups/sub2api-pre-v0.1.186-test.1-20260901T161538Z.dump`，非空且权限受限。
- 只重建了 `sub2api`；PostgreSQL 和 Redis 未重启。三个服务均 running/healthy，应用 restart count 为 0，`/health` 返回 `{"status":"ok"}`。
- 有 URL allowlist、trusted proxy 和 CORS 配置 warning，但没有 fatal 或 migration failure。日志检查不得输出 client IP、请求内容或其他业务元数据。

以上是历史核验结果；每次操作前必须重新检查当前状态，不能把它当成实时事实。

## 操作类型与安全边界

每次开始前明确：`release`、`release-retry`、`deploy`、`rollback` 或 `status`，并确认 tag、commit、GitHub 仓库；涉及服务器时再确认 host/user、目录和部署变体。

1. 创建/推送 tag、dispatch、拉取私有镜像、修改服务器、停止服务、升级和回滚都需要当次明确批准；只读状态检查不包含写操作。
2. 不删除、移动、覆盖或强制更新 tag；不执行无保护的 force push。
3. 新 tag 必须来自实际远程默认分支当前 HEAD，不把 `main`、`master` 或 fork 名写死。
4. 发布前确认工作区含未跟踪文件均干净、`git diff --check` 通过、本地与远程默认分支一致、目标 tag/Release 不存在。
5. 不把 Actions、GitHub Release、GHCR、Docker Hub 和服务器部署合并报告；分别给出成功、失败或未执行。
6. 不读取、打印、复制或提交 `.env`、registry token、数据库/管理员密码、cookie、模型响应、私钥内容或完整敏感日志。
7. 不执行 `docker compose down -v`、`docker volume rm`、`docker system prune`；不删除 `data`、`postgres_data`、`redis_data`；不因应用升级重启 PostgreSQL/Redis。
8. `deploy/docker-deploy.sh` 会下载文件、生成 secrets 和覆盖准备文件，只用于单独批准的首次部署，不用于升级或回滚。
9. 应用迁移是 forward-only；镜像回滚不自动撤销 schema/data。数据库恢复是独立破坏性操作，必须另行批准，不能因 unhealthy 自动执行。

## 发布命令的 worktree 边界

发布预检、server-only tag 创建/推送、full dispatch 和发布后的限定检查必须从已同步 primary checkout 执行。开发代码编辑和 PR verification 在当前会话拥有的 linked worktree 中执行。

开发 workflow hook 只放行本 Skill 的规范发布命令；拒绝命令链、重定向、任意脚本、force push 和 tag 删除/覆盖。通过 hook 不代表发布成功。

## 本地发布前检查

不自动安装或升级工具；缺少依赖时报告名称和版本。

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

可补充 `make build`。还应运行仓库发布配置测试、GoReleaser v2 config check 和 actionlint（仅当工具已安装）；不使用本地 GoReleaser 替代 GitHub Actions 发布。

## 新 server-only tag 发布

获得当次明确批准后：

1. 确认 tag 为合法 SemVer（不使用 `+build`，因为 OCI tag 不支持 `+`），本地/远端 tag 和 GitHub Release 均不存在。
2. 对 prerelease 额外记录发布前 GHCR `latest` digest 和默认分支 VERSION。
3. 在实际默认分支 HEAD 创建 annotated tag：

```bash
git tag -a <tag> -m '<tag>' -m '<release notes>'
git push origin 'refs/tags/<tag>'
```

4. 记录 tag、commit 和 workflow URL。只有 workflow 成功、Release 与 GHCR 检查全部通过后，才能报告 server-only 产物成功。

## 手动 full 发布

获得当次明确批准后，从 GitHub Actions 或 `gh workflow run release.yml` 在远程默认分支 dispatch。不要本地创建 tag。输入必须包括新稳定 tag、release notes 和 `confirm_full=true`。

Full 成功需要分别验证 GitHub Release assets、checksums、多平台 archives、GHCR 架构/manifest；只有配置了 secrets 且实际检查成功才能报告 Docker Hub 成功。

## 发布后产物核验

不能只看 workflow 绿色或 tag 名推断产物。Server-only 至少核验：

- GitHub Release 存在，target/tag commit 正确；prerelease 标记正确；assets 为空；名称显示 Server-only。
- `:<version>` 和 `:<version>-amd64` 均存在并解析到同一 amd64 内容。
- 镜像平台只有 `linux/amd64`，记录远端 digest。
- OCI `org.opencontainers.image.version` 等于不带 `v` 的版本，revision 等于 tag commit。
- prerelease 后 GHCR `latest` digest 不变，默认分支 VERSION 不变且没有 prerelease sync commit。
- 稳定版成功后 `latest` 更新，且默认分支 VERSION 只向前同步。

优先使用 `docker buildx imagetools inspect`；目标服务器 pull 后可用 `docker image inspect` 核对 OS、architecture、RepoDigests 和 labels。本机缺 Docker 时应报告工具缺失，并在具有 Docker 的已批准环境核验，不能只根据工作流推断。

## 构建耗时预期

- 已验证的优化前 server-only baseline 约 5 分 36 秒。
- 前端真实构建是嵌入 Web UI 的固定成本，不能跳过。
- 新 BuildKit cache scope 的第一次 run 需要填充 cache，仍可能约 5–6 分钟。
- 后续 cache 命中目标观察区间约 4–5 分钟，不是 SLA；实际报告 cache export/hit 和各阶段耗时。
- Full 包含多平台 binaries、QEMU、arm64 和 manifests，明显更慢；不得套用 server-only 时间。

## Docker Compose 部署

### 远端只读预检查

以下命令均为单条只读 probe；不得输出 `.env`：

```bash
ssh -i ~/.ssh/hermes_apiyi_ed25519 root@106.15.186.104 'docker version'
ssh -i ~/.ssh/hermes_apiyi_ed25519 root@106.15.186.104 'docker compose version'
ssh -i ~/.ssh/hermes_apiyi_ed25519 root@106.15.186.104 'test -d /opt/sub2api'
ssh -i ~/.ssh/hermes_apiyi_ed25519 root@106.15.186.104 'test -f /opt/sub2api/.env'
ssh -i ~/.ssh/hermes_apiyi_ed25519 root@106.15.186.104 'test -f /opt/sub2api/docker-compose.yml'
ssh -i ~/.ssh/hermes_apiyi_ed25519 root@106.15.186.104 'docker compose --env-file /opt/sub2api/.env -f /opt/sub2api/docker-compose.yml -f /opt/sub2api/docker-compose.release.yml config --quiet'
ssh -i ~/.ssh/hermes_apiyi_ed25519 root@106.15.186.104 'docker compose --env-file /opt/sub2api/.env -f /opt/sub2api/docker-compose.yml -f /opt/sub2api/docker-compose.release.yml ps'
ssh -i ~/.ssh/hermes_apiyi_ed25519 root@106.15.186.104 'systemctl is-active sub2api'
ssh -i ~/.ssh/hermes_apiyi_ed25519 root@106.15.186.104 'docker inspect sub2api --format "{{.Config.Image}} {{.Image}}"'
```

根据实际 mounts 确认 local-directory 变体。若 systemd unit active，不得在相同端口启动 Compose，也不得未经批准停止它。

### 受控 Docker 升级

部署前：

1. 核验版本化 GHCR 镜像的 digest、linux/amd64 和 labels；私有镜像登录用 `--password-stdin`，token 不出现在参数或日志。
2. 记录当前应用 image/digest、正式 override 和 restart count，不输出 `.env`。
3. 对 Compose PostgreSQL 创建非空、权限受限的逻辑备份；同时按批准方式备份应用数据目录。Standalone 使用外部数据库既定备份机制。
4. 生成 digest-pinned candidate override，不使用 `latest`；先运行 `docker compose ... config --quiet`。
5. 拉取成功后原子替换正式 override，保留旧 override、旧镜像和备份。
6. 仅执行 `docker compose ... up -d --no-deps --force-recreate sub2api`，不重建 PostgreSQL/Redis。

部署后检查：

- 应用容器使用请求的 digest，平台和 OCI labels 正确；
- 应用 running/healthy，restart count 无异常；
- PostgreSQL/Redis 仍 running/healthy；
- 实际宿主端口 `/health` 成功；
- 仅检查有限 startup/fatal/migration 信号并脱敏，不输出 client IP、请求或业务数据。

## 二进制 systemd 部署

Full release 的二进制安装事实来自 `deploy/install.sh` 和 `deploy/sub2api.service`：默认目录 `/opt/sub2api`，服务 `sub2api`，配置目录 `/etc/sub2api`。只有 full Release 具备 installer/updater 所需 assets。

```bash
ssh <user>@<host> 'systemctl is-active sub2api || true'
ssh <user>@<host> 'systemctl status --no-pager sub2api'
ssh <user>@<host> 'test -x /opt/sub2api/sub2api'
ssh <user>@<host> '/opt/sub2api/sub2api --version 2>/dev/null || true'
ssh <user>@<host> 'journalctl -u sub2api --since "10 min ago" --no-pager -n 100'
```

升级/指定版本/回滚沿用 `deploy/install.sh` 的 `upgrade`、`upgrade -v <version>`、`rollback <version>`。每次先备份并检查 service、版本、端口和有限日志；不自动回退数据库。

## 回滚

- Docker：恢复已核验的旧 digest/override，只重建应用并执行完整健康检查；保留失败镜像、tag 和备份。
- systemd：仅对具有 full assets 的版本使用 `deploy/install.sh rollback <version>` 或指定版本安装。
- 数据库恢复不是镜像回滚步骤，必须另行批准。

## 状态检查与报告

只执行匹配实际部署变体的只读命令。报告 host/user、目录/变体、当前 image/digest 或二进制版本、应用/数据库/Redis 状态、health 与有限错误检查结论，并明确是否修改服务器。不得把历史或示例当成实时结果，不得输出认证信息、完整日志或业务数据。
