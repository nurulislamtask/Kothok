import { create } from "zustand";

interface TaskState {
  running: Record<number, string>;
  start: (label: string) => number;
  end: (id: number) => void;
}

let nextId = 1;

export const useTasks = create<TaskState>((set) => ({
  running: {},
  start: (label) => {
    const id = nextId++;
    set((s) => ({ running: { ...s.running, [id]: label } }));
    return id;
  },
  end: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.running;
      void _removed;
      return { running: rest };
    }),
}));
