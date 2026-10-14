# Scalbl CRM

## Branches and deploys

- `claude/elegant-franklin-8vnl96` is the **production branch**: Vercel
  auto-deploys every push to it to Production.
- Do all work on that branch (or merge into it). Never deploy or promote
  any other branch to Production: each branch only contains its own
  changes, so deploying one on its own wipes out everything else that
  was live.
- Before pushing, run `npm run build` and make sure it passes.
