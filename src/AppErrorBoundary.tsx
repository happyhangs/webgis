import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): State {
    return { error, stack: error.stack || '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const win = window as Window & {
      __webgisErrors?: Array<{ message: string; stack: string; time: number }>;
    };
    win.__webgisErrors = win.__webgisErrors || [];
    win.__webgisErrors.push({
      message: error.message,
      stack: error.stack || info.componentStack || '',
      time: Date.now(),
    });
  }

  resetLocalState = () => {
    localStorage.removeItem('webgis_state');
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="app-error-screen">
        <div className="app-error-card">
          <strong>页面运行出错</strong>
          <span>{this.state.error.message || '未知错误'}</span>
          <button type="button" className="app-error-reset" onClick={this.resetLocalState}>
            清空本地缓存并刷新
          </button>
          {this.state.stack && <pre>{this.state.stack}</pre>}
        </div>
      </div>
    );
  }
}
