// @ts-nocheck
// strip-safety: removed=10
// source: derived from test/fixtures/languages/tsx.tsx (oh-my-pi/omp-stats@17.3.4, MIT) lines 1-116
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { useCallback, useRef, useState } from "react";
import { AppLayout } from "./app/AppLayout";
import type { DashboardSection } from "./app/routes";
import { useHashRoute } from "./data/useHashRoute";
// eslint-enable @typescript-eslint/no-explicit-any
import {
	BehaviorRoute,
	CostsRoute,
	ErrorsRoute,
	GainRoute,
	ModelsRoute,
	OverviewRoute,
	ProjectsRoute,
	ProvidersRoute,
	RequestsRoute,
	ToolsRoute,
} from "./routes";
import { RequestDrawer } from "./ui/RequestDrawer";

// prettier-ignore
const SECTION_ORDER = ["overview","requests","errors","models","providers","tools","costs","behavior","projects","gain"];

// biome-ignore lint/style/useExportType: keep value export for legacy interop
export type ActiveSection = (typeof SECTION_ORDER)[number];

/**
 * Root application component.
 * Manages routing, range selection, and the global request drawer.
 */
export default function App() {
	// Destructure hash-driven route state; setSection drives the sidebar highlight.
	const { section, setSection, range, setRange } = useHashRoute();
	const [refreshTrigger, setRefreshTrigger] = useState(0);
	const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
	// updatedAt tracks the last successful sync so the toolbar can show a relative timestamp.
	const [updatedAt, setUpdatedAt] = useState<number | null>(() => Date.now());

	// Increment the refresh counter whenever a sync completes successfully.
	const handleSyncComplete = useCallback((result: { success: boolean }) => {
		if (result.success) {
			setRefreshTrigger(prev => prev + 1);
			setUpdatedAt(Date.now());
		}
	}, []);

	// Stable identity so the drawer's effects don't tear down on every App render.
	const closeDrawer = useCallback(() => setSelectedRequestId(null), []);

	const active = section; // the currently active section key

	// Keep every visited section mounted and just toggle visibility. Remounting a
	// route on each navigation replays the chart entry animations (a visible
	// flicker); keeping it alive makes revisits instant while the live chart
	// instances still animate in place on data/range updates. Only the active
	// route fetches/polls (enabled), so hidden routes don't keep hitting the API.
	const mountedRef = useRef<Set<DashboardSection>>(new Set());
	mountedRef.current.add(active);

	// renderRoute returns the route element for a given target section.
	const renderRoute = (target: DashboardSection) => {
		const isActive = target === active;
		switch (target) {
			case "overview":
				return (
					<OverviewRoute
						active={isActive}
						range={range}
						refreshTrigger={refreshTrigger}
						onRequestClick={setSelectedRequestId}
					/>
				);
			case "requests":
				return (
					<RequestsRoute
						active={isActive}
						range={range}
						refreshTrigger={refreshTrigger}
						onRequestClick={setSelectedRequestId}
					/>
				);
			case "errors":
				return (
					<ErrorsRoute
						active={isActive}
						range={range}
						refreshTrigger={refreshTrigger}
						onRequestClick={setSelectedRequestId}
					/>
				);
			case "models":
				// ModelsRoute does not surface individual request clicks.
				return <ModelsRoute active={isActive} range={range} refreshTrigger={refreshTrigger} />;
			case "providers":
				return <ProvidersRoute active={isActive} range={range} refreshTrigger={refreshTrigger} />;
			case "tools":
				return <ToolsRoute active={isActive} range={range} refreshTrigger={refreshTrigger} />;
			case "costs":
				return <CostsRoute active={isActive} range={range} refreshTrigger={refreshTrigger} />;
			case "behavior":
				return <BehaviorRoute active={isActive} range={range} refreshTrigger={refreshTrigger} />;
			case "projects":
				return <ProjectsRoute active={isActive} range={range} refreshTrigger={refreshTrigger} />;
			case "gain":
				return <GainRoute active={isActive} range={range} refreshTrigger={refreshTrigger} />;
		}
	};

	return (
		<>
			{/* Primary layout shell; owns the sidebar and toolbar chrome */}
			<AppLayout
				activeSection={active}
				onSectionChange={setSection}
				range={range}
				onRangeChange={setRange}
				updatedAt={updatedAt}
				onSyncComplete={handleSyncComplete}
			>
				{[...mountedRef.current].map(target => (
					// Each section is always mounted; hidden attr keeps it out of the a11y tree.
					<div key={target} hidden={target !== active}>
						{renderRoute(target)}
					</div>
				))}
			</AppLayout>

			<RequestDrawer id={selectedRequestId} onClose={closeDrawer} />
		</>
	);
}
