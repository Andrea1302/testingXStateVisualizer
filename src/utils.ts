
import * as React from 'react';
import {
  ActionObject,
  ActionTypes,
  AnyEventObject,
  CancelAction,
  Interpreter,
  SendAction,
  StateNode,
  TransitionDefinition,
} from 'xstate';
import { EmbedMode, EmbedPanel,ParsedEmbed } from './types';
import { print } from 'graphql';
import { useSelector } from '@xstate/react';
import { NextRouter } from 'next/router';

export function handlerRemap(data: any) {
  const machine = data.states.reduce((acc: any, { id, type }) => {
    const findTransition = data.transitions.find((el) => el.source === id);
    if (findTransition === undefined) return acc;
    acc[id] = {
      tags: [type],
      on: {
        [findTransition.event]: findTransition.target,
      },
    };
    return acc;
  }, {});
  machine[data.endStates[0]] = {
    type: 'final',
  }
  return {
    id: data.id,
    initial: data.initialState,
    states: machine,
  };
};


export function isNullEvent(eventName: string) {
  return eventName === ActionTypes.NullEvent;
}

export function isInternalEvent(eventName: string) {
  const allInternalEventsButNullEvent = Object.values(ActionTypes).filter(
    (prefix) => !isNullEvent(prefix),
  );
  return allInternalEventsButNullEvent.some((prefix) =>
    eventName.startsWith(prefix),
  );
}

export function createInterpreterContext<
  TInterpreter extends Interpreter<any, any, any>,
  >(displayName: string) {
  const [Provider, useContext] =
    createRequiredContext<TInterpreter>(displayName);

  const createUseSelector =
    <Data>(selector: (state: TInterpreter['state']) => Data) =>
      () => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        return useSelector(useContext(), selector);
      };

  return [Provider, useContext, createUseSelector] as const;
}

export function createRequiredContext<T>(displayName: string) {
  const context = React.createContext<T | null>(null);
  context.displayName = displayName;

  const useContext = () => {
    const ctx = React.useContext(context);
    if (!ctx) {
      throw new Error(
        `use${displayName} must be used inside ${displayName}Provider`,
      );
    }
    return ctx;
  };

  return [context.Provider, useContext] as const;
}

export interface Edge<
  TContext,
  TEvent extends AnyEventObject,
  TEventType extends TEvent['type'] = string,
  > {
  event: TEventType;
  source: StateNode<TContext, any, TEvent>;
  target: StateNode<TContext, any, TEvent>;
  transition: TransitionDefinition<TContext, TEvent>;
  order: number;
}

export function getChildren(stateNode: StateNode): StateNode[] {
  if (!stateNode.states) {
    return [];
  }

  const children = Object.keys(stateNode.states).map((key) => {
    return stateNode.states[key];
  });

  children.sort((a, b) => b.order - a.order);

  return children;
}

export function getEdges(stateNode: StateNode): Array<Edge<any, any, any>> {
  const edges: Array<Edge<any, any, any>> = [];

  Object.keys(stateNode.on).forEach((eventType, order) => {
    const transitions = stateNode.on[eventType];

    transitions.forEach((t) => {
      const targets = t.target && t.target.length > 0 ? t.target : [stateNode];
      targets.forEach((target) => {
        edges.push({
          event: eventType,
          source: stateNode,
          target,
          transition: t,
          order,
        });
      });
    });
  });

  return edges;
}

export const isStringifiedFunction = (str: string): boolean =>
  /^function\s*\(/.test(str) || str.includes('=>');

const testPlatform = (re: RegExp): boolean =>
  re.test(globalThis?.navigator?.platform);

export const isMac = () => testPlatform(/^Mac/);

export const isWithPlatformMetaKey = (event: {
  metaKey: boolean;
  ctrlKey: boolean;
}) => (isMac() ? event.metaKey : event.ctrlKey);

export const getPlatformMetaKeyLabel = () => (isMac() ? 'CMD' : 'Ctrl');

export const updateQueryParamsWithoutReload = (
  mutator: (queries: URLSearchParams) => void,
) => {
  const newURL = new URL(window.location.href);
  mutator(newURL.searchParams);
  window.history.pushState({ path: newURL.href }, '', newURL.href);
};

// export const gQuery = <Data, Variables>(
//   query: any,
//   variables: Variables,
//   accessToken?: string,
// ): Promise<{ data?: Data }> =>
//   fetch(process.env.NEXT_PUBLIC_GRAPHQL_API_URL, {
//     method: 'POST',
//     headers: {
//       'content-type': 'application/json',
//       ...(accessToken && { authorization: 'Bearer ' + accessToken }),
//     },
//     body: JSON.stringify({
//       query: print(query),
//       variables,
//     }),
//   })
//     .then((resp) => resp.json())
//     .then((res) => {
//       /**
//        * Throw the GQL error if it comes - this
//        * doesn't happen by default
//        */
//       if (res.errors) {
//         throw new Error(res.errors[0]!.message);
//       }
//       return res;
//     });

export function willChange(
  machine: any,
  state: any,
  event: AnyEventObject,
): boolean {
  return !!machine.transition(state, event).changed;
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function isDelayedTransitionAction(
  action: ActionObject<any, any>,
): boolean {
  switch (action.type) {
    case ActionTypes.Send: {
      const sendAction = action as SendAction<
        unknown,
        AnyEventObject,
        AnyEventObject
      >;
      return (
        typeof sendAction.event === 'object' &&
        sendAction.event.type.startsWith('xstate.after')
      );
    }
    case ActionTypes.Cancel:
      return `${(action as CancelAction).sendId}`.startsWith('xstate.after');
    default:
      return false;
  }
}

/**
 * /?mode=viz|full|panels default:viz
 * /?mode=panels&panel=code|state|events|actors default:code
 */
export const DEFAULT_EMBED_PARAMS: any = {
  mode: EmbedMode.Viz,
  panel: EmbedPanel.Code,
  showOriginalLink: true,
  readOnly: true,
  pan: false,
  zoom: false,
  controls: false,
};
export const parseEmbedQuery = (query?: NextRouter['query']): ParsedEmbed => {
  const parsedEmbed = DEFAULT_EMBED_PARAMS;

  const getQueryParamValue = (qParamValue: string | string[]) => {
    return Array.isArray(qParamValue) ? qParamValue[0] : qParamValue;
  };

  const computeBooleanQParamValue = (qParamValue: string) => {
    // Parse to number to treat "0" as false
    return !!+qParamValue;
  };

  if (query?.mode) {
    const parsedMode = getQueryParamValue(query?.mode);
    if (Object.values(EmbedMode).includes(parsedMode as EmbedMode)) {
      parsedEmbed.mode = parsedMode as EmbedMode;
    }
  }

  if (query?.panel) {
    const parsedPanel = getQueryParamValue(query?.panel);
    if (Object.values(EmbedPanel).includes(parsedPanel as EmbedPanel)) {
      parsedEmbed.panel = parsedPanel as EmbedPanel;
    }
  }

  if (query?.showOriginalLink) {
    const parsedValue = getQueryParamValue(query?.showOriginalLink);
    parsedEmbed.showOriginalLink = computeBooleanQParamValue(parsedValue);
  }

  if (query?.readOnly) {
    const parsedReadOnly = getQueryParamValue(query?.readOnly);
    parsedEmbed.readOnly = computeBooleanQParamValue(parsedReadOnly);
  }

  if (query?.pan) {
    const parsedPan = getQueryParamValue(query?.pan);
    parsedEmbed.pan = computeBooleanQParamValue(parsedPan);
  }

  if (query?.zoom) {
    const parsedZoom = getQueryParamValue(query?.zoom);
    parsedEmbed.zoom = computeBooleanQParamValue(parsedZoom);
  }

  if (query?.controls) {
    const parsedControls = getQueryParamValue(query?.controls);
    parsedEmbed.controls = computeBooleanQParamValue(parsedControls);
  }

  return parsedEmbed;
};

export function calculatePanelIndexByPanelName(panelName: EmbedPanel) {
  const tabs = Object.values(EmbedPanel);
  const foundPanelIndex = tabs.findIndex((p) => p === panelName);
  return foundPanelIndex >= 0 ? foundPanelIndex : 0;
}

export function withoutEmbedQueryParams(query: any): string {
  const q = new URLSearchParams(query);
  // We don't need embed related query params in the original link
  [
    'mode',
    'panel',
    'showOriginalLink',
    'pan',
    'zoom',
    'controls',
    'readOnly',
  ].forEach((key) => {
    q.delete(key);
  });
  return '/viz?' + q.toString();
}
const isTextAcceptingInputElement = (input: HTMLInputElement) =>
  input.type === 'email' ||
  input.type === 'password' ||
  input.type === 'search' ||
  input.type === 'tel' ||
  input.type === 'text' ||
  input.type === 'url';

const isSvgElement = (el: any): el is SVGElement =>
  !!el && (/svg/i.test(el.tagName) || !!el.ownerSVGElement);

export const isTextInputLikeElement = (
  el: HTMLElement | SVGElement,
): boolean => {
  return (
    (el.tagName === 'INPUT' &&
      isTextAcceptingInputElement(el as HTMLInputElement)) ||
    el.tagName === 'TEXTAREA' ||
    (!isSvgElement(el) && el.isContentEditable)
  );
};

const getRoles = (el: HTMLElement | SVGElement): string[] => {
  const explicitRole = el.getAttribute('role');

  if (explicitRole) {
    // based on https://github.com/testing-library/dom-testing-library/blob/fbbb29a6d9655d41bc8f91d49dc64326f588c0d6/src/queries/role.js#L107-L112
    return explicitRole.split(' ').filter(Boolean);
  }

  // this is obviously highly incomplete atm
  switch (el.tagName) {
    case 'BUTTON':
      return ['button'];
    case 'SELECT': {
      const multiple = el.getAttribute('multiple');
      const size = el.getAttribute('multiple');
      return multiple && size && parseInt(size) > 1
        ? ['listbox']
        : ['combobox'];
    }
    case 'INPUT': {
      const input = el as HTMLInputElement;
      switch (input.type) {
        case 'button':
        case 'image':
        case 'reset':
        case 'submit':
          return ['button'];
        case 'checkbox':
          return ['checkbox'];
        case 'email':
        case 'search':
        case 'tel':
        case 'text':
        case 'url':
          return el.getAttribute('list') ? ['combobox'] : ['textbox'];
        case 'number':
          return ['spinbutton'];
        case 'radio':
          return ['radio'];
        case 'range':
          return ['slider'];
        default:
          return [];
      }
    }
    case 'TEXTAREA':
      return ['textbox'];
    default:
      return [];
  }
};

export const isAcceptingArrowKey = (el: HTMLElement | SVGElement): boolean => {
  if (isTextInputLikeElement(el)) {
    return true;
  }

  if (el.tagName === 'INPUT') {
    const input = el as HTMLInputElement;
    return input.type === 'range';
  }

  // TODO: support accordion headers, aria grids, treegrid (keep in midn that treegrid can contain interactive elements)
  const rolesWithArrowsSupport: Record<string, boolean> = {
    // not every button accepts arrows but let's assume that they all do since menu buttons and buttons in toolbars accept them
    // but there is no good way to quickly differentiate those
    button: true,
    combobox: true,
    listbox: true,
    menu: true,
    menubar: true,
    menuitem: true,
    radio: true,
    radiogroup: true,
    tab: true,
    textbox: true,
    treeitem: true,
    tree: true,
  };
  return getRoles(el).some((role) => rolesWithArrowsSupport[role]);
};

export function paramsToRecord(
  params: { name: string; value: string | boolean }[],
): ParsedEmbed {
  return params.reduce(
    (result, current) => ({
      ...result,
      [current.name]: current.value,
    }),
    {} as ParsedEmbed,
  );
}

export function makeEmbedUrl(id: string, baseUrl: string, params: ParsedEmbed) {
  const paramsWithNumberValues = Object.entries(params).reduce(
    (result, current) => {
      return {
        ...result,
        // Convert true|false to 1|0
        [current[0]]:
          typeof current[1] === 'boolean' ? +current[1] : current[1],
      };
    },
    {},
  );
  const query = new URLSearchParams(paramsWithNumberValues as any);
  return `${baseUrl}/viz/embed/${id}?${query.toString()}`;
}

export const isAcceptingSpaceNatively = (
  el: HTMLElement | SVGElement,
): boolean =>
  // from all the inputs `number` and `range` don't seem to accept space but it's probably not worth it to special case them here
  el.tagName === 'INPUT' ||
  isTextInputLikeElement(el) ||
  getRoles(el).includes('button');
