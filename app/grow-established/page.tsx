import GrowLab from '../lab/grow/GrowLab';
import { establishedNodes, establishedRings, establishedWork } from '../lab/grow-established/fixture';

export default function GrowEstablishedPage() {
  return <GrowLab initialNodes={establishedNodes} sampleRings={establishedRings} sampleWork={establishedWork}
    studyTitle="An established company" focusedRings />;
}
