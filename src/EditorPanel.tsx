import {
  Box,
  Button,
} from '@chakra-ui/react';
import type { Monaco } from '@monaco-editor/react';
import { useMachine, useSelector } from '@xstate/react';
import { editor, Range } from 'monaco-editor';
import { handlerRemap } from './utils';
import EditorWithXStateImports from './EditorWithXStateImports';
import React from 'react';
import { assign, DoneInvokeEvent, send, spawn } from 'xstate';
import { createModel } from 'xstate/lib/model';
import { useAuth } from './authContext';
import { notifMachine } from './notificationMachine';
import { parseMachines } from './parseMachine';
import { createMachine} from "xstate"
import {
  getShouldImmediateUpdate,
  SourceMachineActorRef,
} from './sourceMachine';
import type { AnyStateMachine } from './types';

class SyntaxError extends Error {
  range: Range;
  constructor(message: string, range: Range) {
    super(message);
    this.range = range;
  }

  get title() {
    return `SyntaxError at Line:${this.range.startLineNumber} Col:${this.range.endColumn}`;
  }

  toString() {
    return this.message;
  }
}

const editorPanelModel = createModel(
  {
    code: '',
    // notifRef: undefined! as ActorRefFrom<typeof notifMachine>,
    monacoRef: null as Monaco | null,
    standaloneEditorRef: null as editor.IStandaloneCodeEditor | null,
    sourceRef: null as SourceMachineActorRef,
    mainFile: 'main.ts',
    machines: null as AnyStateMachine[] | null,
    deltaDecorations: [] as string[],
  },
  {
    events: {
      COMPILE: () => ({}),
      EDITOR_READY: (
        monacoRef: Monaco,
        standaloneEditorRef: editor.IStandaloneCodeEditor,
      ) => ({ monacoRef, standaloneEditorRef }),
      UPDATE_MACHINE_PRESSED: () => ({}),
      EDITOR_ENCOUNTERED_ERROR: (message: string, title?: string) => ({
        message,
        title,
      }),
      EDITOR_CHANGED_VALUE: (code: string) => ({ code }),
    },
  },
);

const editorPanelMachine = editorPanelModel.createMachine(
  {
    entry: [assign({ notifRef: () => spawn(notifMachine) })],
    initial: 'booting',
    states: {
      booting: {
        initial: 'waiting_for_monaco',
        on: { EDITOR_CHANGED_VALUE: undefined },
        states: {
          waiting_for_monaco: {
            on: {
              EDITOR_READY: [
                {
                  cond: 'isGist',
                  target: 'fixing_gist_imports',
                  actions: editorPanelModel.assign({
                    monacoRef: (_, e) => e.monacoRef,
                    standaloneEditorRef: (_, e) => e.standaloneEditorRef,
                  }),
                },
                {
                  target: 'done',
                  actions: editorPanelModel.assign({
                    monacoRef: (_, e) => e.monacoRef,
                    standaloneEditorRef: (_, e) => e.standaloneEditorRef,
                  }),
                },
              ],
            },
          },
          fixing_gist_imports: {

          },
          done: {
            type: 'final',
          },
        },
        onDone: [
          {
            cond: (ctx) =>
              getShouldImmediateUpdate(ctx.sourceRef.getSnapshot()!),
            target: 'compiling',
          },
          { target: 'active' },
        ],
      },
      active: {},
      updating: {
        tags: ['visualizing'],
        entry: send('UPDATE_MACHINE_PRESSED'),
        always: 'active',
      },
      compiling: {
        tags: ['visualizing'],
        invoke: {
          src: async (ctx) => {
            const monaco = ctx.monacoRef!;
            const uri = monaco.Uri.parse(ctx.mainFile);
            const tsWoker = await monaco.languages.typescript
              .getTypeScriptWorker()
              .then((worker) => worker(uri));

            const syntaxErrors = await tsWoker.getSyntacticDiagnostics(
              uri.toString(),
            );

            if (syntaxErrors.length > 0) {
              const model = ctx.monacoRef?.editor.getModel(uri);
              // Only report one error at a time
              const error = syntaxErrors[0];

              const start = model?.getPositionAt(error.start!);
              const end = model?.getPositionAt(error.start! + error.length!);
              const errorRange = new ctx.monacoRef!.Range(
                start?.lineNumber!,
                0, // beginning of the line where error occured
                end?.lineNumber!,
                end?.column!,
              );
              return Promise.reject(
                new SyntaxError(error.messageText.toString(), errorRange),
              );
            }

            const compiledSource = await tsWoker
              .getEmitOutput(uri.toString())
              .then((result) => result.outputFiles[0].text);
            console.log(compiledSource, 'compilesource')
            return parseMachines(compiledSource);
          },
          onDone: {
            target: 'updating',
            actions: [
              assign({
                machines: (_, e: any) => e.data,
              }),
            ],
          },
          onError: [
            {
              cond: 'isSyntaxError',
              target: 'active',
              actions: [
                'addDecorations',
                'scrollToLineWithError',
                'broadcastError',
              ],
            },
            {
              target: 'active',
              actions: ['broadcastError'],
            },
          ],
        },
      },
    },
    on: {
      EDITOR_CHANGED_VALUE: {
        actions: [
          editorPanelModel.assign({ code: (_, e) => e.code }),
          'onChangedCodeValue',
          'clearDecorations',
        ],
      },
      EDITOR_ENCOUNTERED_ERROR: {
        actions: send(
          (_, e) => ({
            type: 'BROADCAST',
            status: 'error',
            message: e.message,
          }),
          {
            to: (ctx) => ctx.notifRef,
          },
        ),
      },
      UPDATE_MACHINE_PRESSED: {
        actions: 'onChange',
      },
      COMPILE: 'compiling',
    },
  },
  {
    guards: {
      isGist: (ctx) =>
        ctx.sourceRef.getSnapshot()!.context.sourceProvider === 'gist',
      isSyntaxError: (_, e: any) => e.data instanceof SyntaxError,
    },
    actions: {
      broadcastError: send((_, e: any) => ({
        type: 'EDITOR_ENCOUNTERED_ERROR',
        title: e.data.title,
        message: e.data.message,
      })),
      addDecorations: assign({
        deltaDecorations: (ctx, e) => {
          const {
            data: { range },
          } = e as DoneInvokeEvent<{ message: string; range: Range }>;
          if (ctx.standaloneEditorRef) {
            // TODO: this Monaco API performs a side effect of clearing previous deltaDecorations while creating new decorations
            // Since XState reserves the right to assume assign actions are pure, think of a way to split the effect from assignment
            const newDecorations = ctx.standaloneEditorRef.deltaDecorations(
              ctx.deltaDecorations,
              [
                {
                  range,
                  options: {
                    isWholeLine: true,
                    glyphMarginClassName: 'editor__glyph-margin',
                    className: 'editor__error-content',
                  },
                },
              ],
            );
            return newDecorations;
          }
          return ctx.deltaDecorations;
        },
      }),
      clearDecorations: assign({
        deltaDecorations: (ctx) =>
          ctx.standaloneEditorRef!.deltaDecorations(ctx.deltaDecorations, []),
      }),
      scrollToLineWithError: (ctx, e) => {
        const {
          data: { range },
        } = e as DoneInvokeEvent<{ message: string; range: Range }>;
        const editor = ctx.standaloneEditorRef;
        editor?.revealLineInCenterIfOutsideViewport(range.startLineNumber);
      },
    },
  },
);

export const EditorPanel: React.FC<{
  onChange: (machine: AnyStateMachine[]) => void;
  onChangedCodeValue: (code: string) => void;
}> = ({ onChange, onChangedCodeValue }) => {
  const authService = useAuth();
  const sourceService = useSelector(
    authService,
    (state) => state.context.sourceRef!,
  );
  const baseJson = require('./base.json');
  const value = `import { createMachine} from "xstate";
  createMachine(${JSON.stringify(handlerRemap(baseJson))})`;

  const [current, send] = useMachine(editorPanelMachine, {
    actions: {
      onChange: (ctx) => {
        onChange(ctx.machines!);
      },
      onChangedCodeValue: (ctx) => {
        console.log(ctx.code, 'ctx.code');

        onChangedCodeValue(ctx.code);
      },
    },
    context: {
      ...editorPanelModel.initialContext,
      code: value,
      sourceRef: sourceService,
    },
  });
  const isVisualizing = current.hasTag('visualizing');

  return (
    <>
      <Box
        height="100%"
        display="grid"
        gridTemplateRows="1fr auto"
        data-testid="editor"
      >
        <>
          {/* This extra div acts as a placeholder that is supposed to stretch while EditorWithXStateImports lazy-loads (thanks to `1fr` on the grid) */}
          <div style={{ minHeight: 0, minWidth: 0 }}>
            <EditorWithXStateImports
              value={value}
              onMount={(standaloneEditor, monaco) => {
                send({
                  type: 'EDITOR_READY',
                  monacoRef: monaco,
                  standaloneEditorRef: standaloneEditor,
                });
                setTimeout(function () {
                  standaloneEditor.getAction('editor.action.formatDocument').run();
                }, 100);
              }}
              onChange={(code) => {
                send({ type: 'EDITOR_CHANGED_VALUE', code });
              }}
            />
          </div>
          <div>
            <Button
              disabled={isVisualizing}
              onClick={() => {
                send({
                  type: 'COMPILE',
                });
              }}
            >
              Visualize
            </Button>
          </div>
        </>
      </Box>
    </>
  );
};
