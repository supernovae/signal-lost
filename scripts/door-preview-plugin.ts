import type { Plugin } from 'vite';

const previewPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Door preview | SIGNAL//LOST</title>
  </head>
  <body>
    <div class="crt"><main id="app"></main></div>
    <script type="module" src="/src/app/door-preview.ts"></script>
  </body>
</html>`;

export function doorPreviewPlugin(): Plugin {
  return {
    name: 'signal-lost-door-preview',
    apply: 'serve',
    configureServer(server) {
      const path = `${server.config.base}door-preview`;
      server.middlewares.use(async (request, response, next) => {
        const url = request.url;
        if (request.method !== 'GET' || !url || url.split('?', 1)[0] !== path) {
          next();
          return;
        }
        try {
          const html = await server.transformIndexHtml(url, previewPage);
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(html);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
