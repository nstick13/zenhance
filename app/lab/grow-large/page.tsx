import GrowLab from '../grow/GrowLab';
import { largeNodes, largeRings, largeWork } from './fixture';

export default function GrowLargeLabPage() {
  return <GrowLab initialNodes={largeNodes} sampleRings={largeRings} sampleWork={largeWork}
    studyTitle="A messy 1,000-person company · 30 levels · two families"
    scaleMode="large" focusedRings
    initialFocusId="large-field-1"
    focusStops={[
      { id: 'large-centre', label: 'Main centre', zoom: 0.75 },
      { id: 'large-deep-15', label: 'Continuity · level 15', zoom: 1.5 },
      { id: 'large-deep-30', label: 'Continuity · level 30', zoom: 1.7 },
      { id: 'large-field-1', label: 'Field Operations', zoom: 1.2 },
      { id: 'large-regional-1', label: 'Regional Network', zoom: 1.2 },
      { id: 'large-floating-1', label: 'Independent Cooperative', zoom: 1.2 },
      { id: 'large-floating-10', label: 'Cooperative · level 10', zoom: 1.7 },
    ]} />;
}
