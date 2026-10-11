import "./AppBar.ai.css";
import type { DisplayOptions } from "../../App";

interface AppBarProps {
  programId: string;
  dispatch: (command: string) => void;
  displayOptions: DisplayOptions;
  setDisplayOptions: (displayOptions: DisplayOptions) => void;
}

export function AppBar({}: AppBarProps) {
  return <div className="AppBar">AppBar</div>;
}
