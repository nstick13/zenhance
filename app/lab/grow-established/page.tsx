import GrowLab from '../grow/GrowLab';
import { establishedNodes, establishedRings } from './fixture';

export default function GrowEstablishedPage() {
  return <GrowLab initialNodes={establishedNodes} sampleRings={establishedRings}
    studyTitle="An established company" />;
}
