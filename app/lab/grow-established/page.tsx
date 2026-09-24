import GrowLab from '../grow/GrowLab';
import { establishedNodes, establishedRings, establishedWork } from './fixture';

export default function GrowEstablishedPage() {
  return <GrowLab initialNodes={establishedNodes} sampleRings={establishedRings} sampleWork={establishedWork}
    studyTitle="An established company" focusedRings />;
}
