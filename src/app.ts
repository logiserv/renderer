import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as _ from 'lodash';
import { RenderGRPCPluginV1 } from './plugin/v1/grpc_plugin';
import { RenderGRPCPluginV2 } from './plugin/v2/grpc_plugin';
import { HttpServer } from './service/http-server';
import { ConsoleLogger, PluginLogger } from './logger';
import { createBrowser } from './browser';
import * as minimist from 'minimist';
import { defaultPluginConfig, defaultServiceConfig, readJSONFileSync, PluginConfig, ServiceConfig } from './config';
import { serve } from './node-plugin';

async function main() {
  const argv = minimist(process.argv.slice(2));
  const env = Object.assign({}, process.env);
  const command = argv._[0];

  if (command === undefined) {
    const logger = new PluginLogger();
    const config: PluginConfig = defaultPluginConfig;
    populatePluginConfigFromEnv(config, env);

    if (!config.rendering.chromeBin && (process as any).pkg) {
      const parts = puppeteer.executablePath().split(path.sep);
      while (!parts[0].startsWith('chrome-')) {
        parts.shift();
      }

      config.rendering.chromeBin = [path.dirname(process.execPath), ...parts].join(path.sep);
    }

    await serve({
      handshakeConfig: {
        protocolVersion: 2,
        magicCookieKey: 'grafana_plugin_type',
        magicCookieValue: 'datasource',
      },
      versionedPlugins: {
        1: {
          'grafana-image-renderer': new RenderGRPCPluginV1(config, logger),
        },
        2: {
          renderer: new RenderGRPCPluginV2(config, logger),
        },
      },
      logger: logger,
      grpcHost: config.plugin.grpc.host,
      grpcPort: config.plugin.grpc.port,
    });
  } else if (command === 'server') {
    let config: ServiceConfig = defaultServiceConfig;

    if (argv.config) {
      try {
        const fileConfig = readJSONFileSync(argv.config);
        config = _.merge(config, fileConfig);
      } catch (e) {
        console.error('failed to read config from path', argv.config, 'error', e);
        return;
      }
    }

    populateServiceConfigFromEnv(config, env);

    const logger = new ConsoleLogger(config.service.logging);
    const browser = createBrowser(config.rendering, logger);
    const server = new HttpServer(config, logger, browser);

    await server.start();
  } else {
    console.log('Unknown command');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

function populatePluginConfigFromEnv(config: PluginConfig, env: NodeJS.ProcessEnv) {
  // Plugin v1 legacy env variables
  if (env['GF_RENDERER_PLUGIN_TZ']) {
    config.rendering.timezone = env['GF_RENDERER_PLUGIN_TZ'];
  } else {
    config.rendering.timezone = env['TZ'];
  }

  if (env['GF_RENDERER_PLUGIN_GRPC_PORT']) {
    config.plugin.grpc.port = parseInt(env['GF_RENDERER_PLUGIN_GRPC_PORT'] as string, 10);
  }

  if (env['GF_RENDERER_PLUGIN_IGNORE_HTTPS_ERRORS']) {
    config.rendering.ignoresHttpsErrors = env['GF_RENDERER_PLUGIN_IGNORE_HTTPS_ERRORS'] === 'true';
  }

  if (env['GF_RENDERER_PLUGIN_CHROME_BIN']) {
    config.rendering.chromeBin = env['GF_RENDERER_PLUGIN_CHROME_BIN'];
  }

  if (env['GF_RENDERER_PLUGIN_VERBOSE_LOGGING']) {
    config.rendering.verboseLogging = env['GF_RENDERER_PLUGIN_VERBOSE_LOGGING'] === 'true';
  }

  // Plugin v2 env variables needs to be initiated early
  if (env['GF_PLUGIN_GRPC_HOST']) {
    config.plugin.grpc.host = env['GF_PLUGIN_GRPC_HOST'] as string;
  }

  if (env['GF_PLUGIN_GRPC_PORT']) {
    config.plugin.grpc.port = parseInt(env['GF_PLUGIN_GRPC_PORT'] as string, 10);
  }
}

function populateServiceConfigFromEnv(config: ServiceConfig, env: NodeJS.ProcessEnv) {
  if (env['BROWSER_TZ']) {
    config.rendering.timezone = env['BROWSER_TZ'];
  } else {
    config.rendering.timezone = env['TZ'];
  }

  if (env['HTTP_HOST']) {
    config.service.host = env['HTTP_HOST'];
  }

  if (env['HTTP_PORT']) {
    config.service.port = parseInt(env['HTTP_PORT'] as string, 10);
  }

  if (env['LOG_LEVEL']) {
    config.service.logging.level = env['LOG_LEVEL'] as string;
  }

  if (env['IGNORE_HTTPS_ERRORS']) {
    config.rendering.ignoresHttpsErrors = env['IGNORE_HTTPS_ERRORS'] === 'true';
  }

  if (env['CHROME_BIN']) {
    config.rendering.chromeBin = env['CHROME_BIN'];
  }

  if (env['ENABLE_METRICS']) {
    config.service.metrics.enabled = env['ENABLE_METRICS'] === 'true';
  }

  if (env['RENDERING_MODE']) {
    config.rendering.mode = env['RENDERING_MODE'] as string;
  }

  if (env['RENDERING_CLUSTERING_MODE']) {
    config.rendering.clustering.mode = env['RENDERING_CLUSTERING_MODE'] as string;
  }

  if (env['RENDERING_CLUSTERING_MAX_CONCURRENCY']) {
    config.rendering.clustering.maxConcurrency = parseInt(env['RENDERING_CLUSTERING_MAX_CONCURRENCY'] as string, 10);
  }

  if (env['RENDERING_VERBOSE_LOGGING']) {
    config.rendering.verboseLogging = env['RENDERING_VERBOSE_LOGGING'] === 'true';
  }

  if (env['RENDERING_DEFAULT_TIMEOUT']) {
    config.rendering.defaultTimeout = parseInt(env['RENDERING_DEFAULT_TIMEOUT'] as string, 10);
  }

  if (env['RENDERING_DUMPIO']) {
    config.rendering.dumpio = env['RENDERING_DUMPIO'] === 'true';
  }

  if (env['RENDERING_ARGS']) {
    const args = env['RENDERING_ARGS'] as string;
    if (args.length > 0) {
      const argsList = args.split(',');
      if (argsList.length > 0) {
        config.rendering.args = argsList;
      }
    }
  }
}
