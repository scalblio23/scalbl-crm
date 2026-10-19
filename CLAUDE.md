# Scalbl CRM

## Branches and deploys

- `main` is the **production branch**: Vercel auto-deploys every push to
  it to Production. Get work onto `main` (merge or pull request).
- Never deploy or promote any other branch to Production: each branch
  only contains its own changes, so deploying one on its own wipes out
  everything else that was live.
- Before pushing, run `npm run build` and make sure it passes.
- Changing the Production branch is done in Vercel → Settings →
  Environments → Production → Branch Tracking.

## Voice gateway (DigitalOcean)

- Powerdialler / Multi Line calls and live transfer run through the SIP
  voice gateway (`server/voiceGateway.js`, `server/sip/`), which runs on
  a DigitalOcean Droplet, NOT on Vercel. Pushing to `main` does not
  update it.
- Update it by re-running `deploy/voice-gateway/setup.sh` on the Droplet
  (it installs `main` by default). Changes to `server/sip/` only take
  effect after that.
