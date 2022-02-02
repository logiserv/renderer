import { Cluster } from 'poolpeteer';
import { ImageRenderOptions, RenderOptions } from '../types';
import { Browser, RenderResponse, RenderCSVResponse, Metrics } from './browser';
import { Logger } from '../logger';
import { RenderingConfig, ClusteringConfig } from '../config';
import { ConcurrencyImplementationClassType } from 'poolpeteer/dist/concurrency/ConcurrencyImplementation';

enum RenderType {
  CSV = 'csv',
  PNG = 'png',
}

interface ClusterOptions {
  groupId?: string;
  options: RenderOptions | ImageRenderOptions;
  renderType: RenderType;
}

type ClusterResponse = RenderResponse | RenderCSVResponse;

const contextPerRenderKey = 'contextPerRenderKey';

export class ClusteredBrowser extends Browser {
  cluster: Cluster<ClusterOptions, ClusterResponse>;
  clusteringConfig: ClusteringConfig;
  concurrency: number | ConcurrencyImplementationClassType;

  constructor(config: RenderingConfig, log: Logger, metrics: Metrics) {
    super(config, log, metrics);

    this.clusteringConfig = config.clustering;
    this.concurrency = Cluster.CONCURRENCY_BROWSER;

    if (this.clusteringConfig.mode === 'context') {
      this.concurrency = Cluster.CONCURRENCY_CONTEXT;
    }

    if (this.clusteringConfig.mode === contextPerRenderKey) {
      this.concurrency = Cluster.CONCURRENCY_CONTEXT_PER_REQUEST_GROUP;
    }
  }

  async start(): Promise<void> {
    const launcherOptions = this.getLauncherOptions({});
    this.cluster = await Cluster.launch<ClusterOptions, ClusterResponse>({
      concurrency: this.concurrency,
      workerShutdownTimeout: 5000,
      monitor: this.clusteringConfig.monitor,
      maxConcurrency: this.clusteringConfig.maxConcurrency,
      timeout: this.clusteringConfig.timeout * 1000,
      workerCreationDelay: 1000,
      puppeteerOptions: launcherOptions,
    });
    await this.cluster.task(async ({ page, data }) => {
      if (data.options.timezone) {
        // set timezone
        await page.emulateTimezone(data.options.timezone);
      }

      try {
        this.addPageListeners(page);
        switch (data.renderType) {
          case RenderType.CSV:
            return await this.exportCSV(page, data.options);
          case RenderType.PNG:
          default:
            return await this.takeScreenshot(page, data.options as ImageRenderOptions);
        }
      } finally {
        this.removePageListeners(page);
      }
    });
  }

  private getGroupId = (options: ImageRenderOptions | RenderOptions) => {
    if (this.clusteringConfig.mode === contextPerRenderKey) {
      return options.renderKey;
    }

    return undefined;
  };

  async render(options: ImageRenderOptions): Promise<RenderResponse> {
    this.validateImageOptions(options);
    return this.cluster.execute({ groupId: this.getGroupId(options), options, renderType: RenderType.PNG });
  }

  async renderCSV(options: RenderOptions): Promise<RenderCSVResponse> {
    this.validateRenderOptions(options);
    return this.cluster.execute({ groupId: this.getGroupId(options), options, renderType: RenderType.CSV });
  }
}
