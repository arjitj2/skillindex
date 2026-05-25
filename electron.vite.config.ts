import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

import { injectRendererConnectSrc, injectRendererImgSrc, resolveRendererDevPort } from './src/shared/renderer-dev-config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probeServer = net.createServer();
    probeServer.unref();

    probeServer.once('error', () => {
      resolve(false);
    });

    probeServer.listen({ host: '127.0.0.1', port }, () => {
      probeServer.close((error) => {
        resolve(!error);
      });
    });
  });
}

export default defineConfig(async () => {
  const rendererPort = await resolveRendererDevPort(process.env.PORT, isPortAvailable);
  const buildFlavor = process.env.SKILL_INDEX_BUILD_FLAVOR === 'dev-alpha' ? 'dev-alpha' : 'standard';
  const buildFlavorDefine = {
    __SKILL_INDEX_BUILD_FLAVOR__: JSON.stringify(buildFlavor),
  };

  return {
    main: {
      define: buildFlavorDefine,
      build: {
        outDir: 'out/main',
        rollupOptions: {
          input: {
            index: path.resolve(rootDir, 'src/main/index.ts'),
          },
        },
      },
      resolve: {
        alias: {
          '@main': path.resolve(rootDir, 'src/main'),
          '@shared': path.resolve(rootDir, 'src/shared'),
        },
      },
    },
    preload: {
      define: buildFlavorDefine,
      build: {
        outDir: 'out/preload',
        rollupOptions: {
          input: {
            index: path.resolve(rootDir, 'src/preload/index.ts'),
          },
        },
      },
      resolve: {
        alias: {
          '@main': path.resolve(rootDir, 'src/main'),
          '@preload': path.resolve(rootDir, 'src/preload'),
          '@shared': path.resolve(rootDir, 'src/shared'),
        },
      },
    },
    renderer: {
      define: buildFlavorDefine,
      root: path.resolve(rootDir, 'src/renderer'),
      resolve: {
        alias: {
          '@renderer': path.resolve(rootDir, 'src/renderer/src'),
          '@shared': path.resolve(rootDir, 'src/shared'),
        },
      },
      plugins: [
        react(),
        {
          name: 'skill-index-renderer-csp-connect-src',
          transformIndexHtml(html: string) {
            return injectRendererImgSrc(injectRendererConnectSrc(html, rendererPort));
          },
        },
      ],
      server: {
        host: '127.0.0.1',
        port: rendererPort,
        strictPort: true,
      },
      preview: {
        host: '127.0.0.1',
        port: rendererPort,
        strictPort: true,
      },
    },
  };
});
