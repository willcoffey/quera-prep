export class Core {
  state: CoreState;
  constructor() {
    this.state = {
      programId: "Lorem",
      selectedQubits: [1, 0, 3],
    };
  }

  dispatch(command: string) {
    console.log(command);
  }

  onChange: () => void = () => {};
}

interface CoreState {
  programId: string;
  selectedQubits: number[];
}
