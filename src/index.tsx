import { AppUiProvider } from "@canva/app-ui-kit";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "@canva/app-ui-kit/styles.css";
import { QueryClient, QueryClientProvider} from '@tanstack/react-query'
const root = createRoot(document.getElementById("root") as Element);
const client = new QueryClient()
function render() {
  root.render(
    <AppUiProvider>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
    </AppUiProvider>
  );
}

render();

if (module.hot) {
  module.hot.accept("./app", render);
}
