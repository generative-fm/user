import { promisifyRequest } from '@alexbainter/indexed-db';
import openDb from './open-db';
import ACTION_OBJECT_STORE_NAME from './action-object-store-name';

const storeAction = (action) =>
  openDb().then((db) =>
    promisifyRequest(
      db
        .transaction(ACTION_OBJECT_STORE_NAME, 'readwrite')
        .objectStore(ACTION_OBJECT_STORE_NAME)
        .put(action)
    )
      .then(() => true)
      .catch((err) => {
        console.error(err);
        return false;
      })
  );

export default storeAction;
