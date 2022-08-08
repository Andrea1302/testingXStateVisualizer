
import { createModel } from 'xstate/lib/model';
export const notifModel = createModel(
  {},
  {
    events: {
      BROADCAST: () => ({
        message: '',
        status: '',
        title: '',
      }),
    },
  },
);
export const notifMachine = notifModel.createMachine({
  initial: 'running',
  context: {},
  on: {
    BROADCAST: {
      actions: [
        (_, e) => {
          const id = e.message;
          console.log('id', id)
          if (id) {
            alert(id)
          }
        },
      ],
    },
  },
  states: {
    running: {},
  },
});
