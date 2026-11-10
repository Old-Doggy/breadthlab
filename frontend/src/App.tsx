import { Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import Today from "./pages/Today";
import Market from "./pages/Market";
import Regime from "./pages/Regime";
import Sectors from "./pages/Sectors";
import Stocks from "./pages/Stocks";
import Sentiment from "./pages/Sentiment";
import Watchlist from "./pages/Watchlist";
import About from "./pages/About";
import Briefing from "./pages/Briefing";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Today />} />
        <Route path="market" element={<Market />} />
        <Route path="regime" element={<Regime />} />
        <Route path="sectors" element={<Sectors />} />
        <Route path="stocks" element={<Stocks />} />
        <Route path="sentiment" element={<Sentiment />} />
        <Route path="watchlist" element={<Watchlist />} />
        <Route path="about" element={<About />} />
        <Route path="briefing" element={<Briefing />} />
      </Route>
    </Routes>
  );
}
