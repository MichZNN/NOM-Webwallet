# Fork conventions (MichZNN/NOM-Webwallet)

This repository is a fork of digitalSloth/nom-webwallet. The root `CLAUDE.md`
belongs to upstream; fork-specific rules live here so upstream merges stay clean.

- Commit messages: English, Conventional Commits (`feat:`, `fix:`, `build:`, `test:`, `docs:`, ...).
- Keep upstream files changing as little as possible; prefer new files for fork-only
  additions (Docker, deploy workflow, docs).
- Deployment is Docker-based: see `docs/DOCKER.md`. Never reuse upstream's
  `SSH_*` / `DEPLOY_PATH` secret names (upstream's `deploy.yml` runs `rsync --delete`).
- Validate every change with `npm run typecheck`, `npm test` and `npm run lint`; for UI flows
  that publish blocks also `npm run e2e` (mocked node, see `docs/E2E.md`).
- Chain rules (amounts, name formats, cooldowns) are checked against go-zenon's
  `vm/constants/embedded.go` and `vm/embedded/implementation/*`, not guessed.
