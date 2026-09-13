import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { onError: (error: Error) => void; children: ReactNode };
type State = { failed: boolean };

/**
 * A boundary around the 3D scene only. A renderer that throws (context loss, a
 * shader failure, a bad frame) is reported to the route, which swaps the whole
 * page to the Chamber's own fallback — never the app-wide error page, and never
 * any other route. Nothing is disposed here: React Three Fiber owns the renderer
 * lifecycle and tears it down when the Canvas unmounts.
 */
export class ChamberErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error("[chamber] scene error", error, info.componentStack);
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
