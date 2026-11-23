// @aws-sdk/client-s3 on a Map, so S3Storage runs unchanged against a bucket in memory.

const objects = new Map<string, Buffer>();
const failingDeletes = new Set<string>();

interface CommandInput {
  Key: string;
  Body?: Buffer;
}

class Command {
  constructor(readonly input: CommandInput) {}
}
class PutObjectCommand extends Command {}
class GetObjectCommand extends Command {}
class DeleteObjectCommand extends Command {}
class HeadObjectCommand extends Command {}

function notFound(name: string) {
  return Object.assign(new Error(`${name}: no such object`), { name });
}

class S3Client {
  async send(command: Command) {
    const { Key, Body } = command.input;
    if (command instanceof PutObjectCommand) {
      objects.set(Key, Buffer.from(Body!));
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      if (failingDeletes.has(Key)) throw Object.assign(new Error('Service Unavailable'), { name: 'ServiceUnavailable' });
      objects.delete(Key);
      return {};
    }

    const bytes = objects.get(Key);
    if (command instanceof HeadObjectCommand) {
      if (!bytes) throw notFound('NotFound');
      return {};
    }
    if (!bytes) throw notFound('NoSuchKey');
    return {
      ContentLength: bytes.length,
      Body: {
        transformToByteArray: async () => new Uint8Array(bytes),
        transformToWebStream: () => new Blob([new Uint8Array(bytes)]).stream(),
      },
    };
  }
}

export const fakeBucket = { objects, failingDeletes };

export function fakeS3Module() {
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand };
}
