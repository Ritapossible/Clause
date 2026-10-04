import { APP_ROUTES, href, useApp } from "./state";
import { AppBar, SiteHeader } from "./components/Header";
import { Mark } from "./components/icons";
import { Home } from "./views/Home";
import { How } from "./views/How";
import { Deals } from "./views/Deals";
import { NewDeal } from "./views/NewDeal";
import { DealView } from "./views/DealView";

const REPO = "https://github.com/Ritapossible/Clause";

export function App() {
  const { route } = useApp();
  const inApp = APP_ROUTES.has(route.name);
  return (
    <>
      <a className="sr-only" href="#main">Skip to content</a>
      <SiteHeader />
      {inApp && <AppBar />}
      <main id="main">
        {route.name === "home" && <Home />}
        {route.name === "how" && <How />}
        {inApp && (
          <div className="wrap app-main" style={{ paddingTop: 28 }}>
            {route.name === "deals" && <Deals />}
            {route.name === "new" && <NewDeal />}
            {route.name === "deal" && <DealView id={route.id} />}
          </div>
        )}
      </main>
      <footer className="site-foot">
        <div className="wrap">
          <div>
            <a className="logo" href="#/" style={{ marginBottom: 12 }}>
              <Mark size={28} />
              <b style={{ fontSize: 22 }}>Clause</b>
            </a>
            <p style={{ margin: "12px 0 0", maxWidth: "34ch" }}>
              Escrow paid per clause, disputed only by citing one. A GenLayer Intelligent Contract. MIT licensed.
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li><a href={href({ name: "deals" })}>App</a></li>
              <li><a href={href({ name: "new" })}>Fund a deal</a></li>
              <li><a href={href({ name: "how" })}>How it works</a></li>
            </ul>
          </div>
          <div>
            <h4>Ecosystem</h4>
            <ul>
              <li><a href="https://genlayer.com" target="_blank" rel="noreferrer">genlayer.com</a></li>
              <li><a href="https://skills.genlayer.com" target="_blank" rel="noreferrer">skills.genlayer.com</a></li>
              <li><a href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a></li>
            </ul>
          </div>
        </div>
      </footer>
    </>
  );
}
