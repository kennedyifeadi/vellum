import { createMemoryVideoJobStore } from './helpers/memoryVideoJobStore';
import { describeVideoJobStoreContract } from './helpers/videoJobStoreContract';

// The worker tests run on this store, so it must behave as the MongoDB one does; the same
// contract runs against a real database in tests/video-job-store-mongo.test.ts.
describeVideoJobStoreContract('in-memory store', createMemoryVideoJobStore, async () => {});
