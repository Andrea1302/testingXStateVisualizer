import { createModel } from 'xstate/lib/model';
import { ModelEventsFrom } from 'xstate/lib/model.types';
import { localCache } from './localCache';
import { EmbedContext } from './types';

export enum ZoomFactor {
  slow = 1.09,
  normal = 1.15,
}

const initialPosition = {
  zoom: 1,
  pan: {
    dx: 0,
    dy: 0,
  },
  canvasPanelPosition: {
    offsetY: 50,
    offsetX: 0,
    width: 0,
    height: 0,
  },
};

const initialContext = {
  ...initialPosition,
  embed: null as EmbedContext | null,
};

export type Pan = {
  dx: number;
  dy: number;
};

export const canvasModel = createModel(initialContext, {
  events: {
    'ZOOM.OUT': (x?: number, y?: number, zoomFactor?: ZoomFactor) => ({
      zoomFactor,
      x,
      y,
    }),
    'ZOOM.IN': (x?: number, y?: number, zoomFactor?: ZoomFactor) => ({
      zoomFactor,
      x,
      y,
    }),
    'POSITION.RESET': () => ({}),
    PAN: (dx: number, dy: number) => ({ dx, dy }),
    /**
     * Occurs when a source changed id
     */
    SOURCE_CHANGED: (id: string | null) => ({
      id,
    }),
    CANVAS_RECT_CHANGED: (
      offsetY: number,
      offsetX: number,
      width: number,
      height: number,
    ) => ({
      offsetX,
      offsetY,
      width,
      height,
    }),
  },
});

const DEFAULT_ZOOM_IN_FACTOR = ZoomFactor.normal;
// exactly reversed factor so zooming in & out results in the same zoom values
const calculateZoomOutFactor = (zoomInFactor: ZoomFactor = ZoomFactor.normal) =>
  1 / zoomInFactor;
const MAX_ZOOM_OUT_FACTOR = 0.1;

const MAX_ZOOM_IN_FACTOR = 2;

export const canZoom = (ctx: typeof initialContext) => {
  return !ctx.embed?.isEmbedded || (ctx.embed.isEmbedded && ctx.embed.zoom);
};

export const canZoomOut = (ctx: typeof initialContext) => {
  return ctx.zoom > MAX_ZOOM_OUT_FACTOR;
};

export const canZoomIn = (ctx: typeof initialContext) => {
  return ctx.zoom < MAX_ZOOM_IN_FACTOR;
};

export const canPan = (ctx: typeof initialContext) => {
  return !ctx.embed?.isEmbedded || (ctx.embed.isEmbedded && ctx.embed.pan);
};

/**
 * Implementation copied from:
 *
 * https://github.com/excalidraw/excalidraw/blob/10cd6a24b0d5715d25ad413784a4b5b57f500b79/src/scene/zoom.ts
 */
const getNewZoomAndPan = (
  prevZoomValue: number,
  newZoomValue: number,
  currentPan: Pan,
  cursorPosition: Pan,
  canvasOffset: {
    offsetY: number;
    offsetX: number;
  },
): { zoom: number; pan: Pan } => {
  return {
    zoom: newZoomValue,
    pan: {
      dx:
        cursorPosition.dx -
        canvasOffset.offsetX -
        (cursorPosition.dx - canvasOffset.offsetX - currentPan.dx) *
          (newZoomValue / prevZoomValue),
      dy:
        cursorPosition.dy -
        canvasOffset.offsetY -
        (cursorPosition.dy - canvasOffset.offsetY - currentPan.dy) *
          (newZoomValue / prevZoomValue),
    },
  };
};

export const canvasMachine = canvasModel.createMachine({
  on: {
    CANVAS_RECT_CHANGED: {
      actions: canvasModel.assign((ctx, e) => {
        return {
          canvasPanelPosition: {
            offsetY: e.offsetY,
            offsetX: e.offsetX,
            height: e.height,
            width: e.width,
          },
        };
      }),
    },
    'ZOOM.OUT': {
      actions: canvasModel.assign((ctx, e) => {
        return getNewZoomAndPan(
          ctx.zoom,
          ctx.zoom * calculateZoomOutFactor(e.zoomFactor),
          ctx.pan,
          {
            dx: e.x || ctx.canvasPanelPosition.width / 2,
            dy: e.y || ctx.canvasPanelPosition.height / 2,
          },
          ctx.canvasPanelPosition,
        );
      }),
      cond: (ctx) => canZoom(ctx) && canZoomOut(ctx),
      target: '.throttling',
      internal: false,
    },
    'ZOOM.IN': {
      actions: canvasModel.assign((ctx, e) => {
        return getNewZoomAndPan(
          ctx.zoom,
          ctx.zoom * (e.zoomFactor || DEFAULT_ZOOM_IN_FACTOR),
          ctx.pan,
          {
            dx: e.x || ctx.canvasPanelPosition.width / 2,
            dy: e.y || ctx.canvasPanelPosition.height / 2,
          },
          ctx.canvasPanelPosition,
        );
      }),
      cond: (ctx) => canZoom(ctx) && canZoomIn(ctx),
      target: '.throttling',
      internal: false,
    },
    PAN: {
      actions: canvasModel.assign({
        pan: (ctx, e) => {
          return {
            dx: ctx.pan.dx - e.dx,
            dy: ctx.pan.dy - e.dy,
          };
        },
      }),
      cond: (ctx) => canPan(ctx),
      target: '.throttling',
      internal: false,
    },
    'POSITION.RESET': {
      actions: canvasModel.assign(initialPosition),
      target: '.throttling',
      internal: false,
    },
    SOURCE_CHANGED: {
      target: '.throttling',
      internal: false,
      actions: canvasModel.assign((context, event) => {
        // TODO: This can be more elegant when we have system actor
        if (!context.embed?.isEmbedded) {
          const position = getPositionFromEvent(event);

          if (!position) return {};

          return position;
        }
        return {};
      }),
    },
  },
  initial: 'idle',
  states: {
    idle: {},
    throttling: {
      after: {
        300: 'saving',
      },
      meta: {
        description: `
          Throttling a moment before saving to ensure
          we don't do too much saving to localStorage
        `,
      },
    },
    saving: {
      always: {
        actions: 'persistPositionToLocalStorage',
        target: 'idle',
      },
    },
  },
});

const getPositionFromEvent = (event: ModelEventsFrom<typeof canvasModel>) => {
  if (event.type !== 'SOURCE_CHANGED') return null;

  const position = localCache.getPosition(event.id);
  return position;
};
