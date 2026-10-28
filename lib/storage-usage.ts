import mongoose from 'mongoose';
import Conversion from '@/models/conversion';
import UserDocumentModel from '@/models/userDocument';

/** The bytes counted against a user's storage quota: conversion history and stored documents. */
export async function usedStorageBytes(userId: string): Promise<number> {
  const totalFileSize = [
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: null, total: { $sum: '$fileSize' } } },
  ];
  const [[conversions], [documents]] = await Promise.all([
    Conversion.aggregate<{ total: number }>(totalFileSize),
    UserDocumentModel.aggregate<{ total: number }>(totalFileSize),
  ]);
  return (conversions?.total ?? 0) + (documents?.total ?? 0);
}
