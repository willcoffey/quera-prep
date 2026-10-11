import "./QubitSelector.ai.css";

interface QubitSelectorProps {
  selectedQubits: number[];
  dispatch: (command: string) => void;
}

export function QubitSelector({}: QubitSelectorProps) {
  return <div className="QubitSelector">QubitSelector</div>;
}
