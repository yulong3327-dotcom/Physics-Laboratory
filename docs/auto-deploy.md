# Physics Laboratory deployment

Repository: https://git.yukework.com/zhayulong/yulong-physics-laboratory

This release publishes only the electricity and optics laboratories.
The entry point is src/LabApp.tsx. Echo and the video workbench are excluded
from the client bundle, server output and production image. The runtime needs
only Node 24 and listens on 0.0.0.0:8080. CI uses the global-runner template.

Run `npm ci --include=dev` and `npm run build`, then deploy with
`/zyb-auto-deploy:auto-deploy test` in ZCode. The health endpoint is `/api/health`.

Both laboratories open without login; AI recognition alone requires an in-app
AI connection. Credentials are not included in
the repository or image. Optional server settings can be published as `app.env`
through the plugin; the server reads it from `APP_CONFIG_DIR`. Existing process
environment variables take precedence. A missing optional file is allowed.

Application logs go to stdout with the required structured fields. Incoming
Zyb-Trace-Id and Uber-Trace-Id headers are forwarded by the AI proxy.

Laboratory drafts and exports stay in the browser. This release needs no
database or server file storage. Existing video sources remain in Git history
and the original development directory; no video service is deployed.

The original development directory is `../circuit-converter`; this deployment
checkout is separate. Further changes must be copied here, verified, committed
and pushed before another deployment.
