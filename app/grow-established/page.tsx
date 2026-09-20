import GrowLab from '../lab/grow/GrowLab';
import { establishedNodes, establishedRings } from '../lab/grow-established/fixture';

export default function GrowEstablishedPage() {
  return <GrowLab initialNodes={establishedNodes} sampleRings={establishedRings}
    studyTitle="An established company" />;
}
