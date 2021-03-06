import { FETCH_USER } from './fetch/fetch-user-action';
import { USER_AUTHENTICATED } from './user-authenticated';
import fetchUser from './fetch/fetch-user';
import userFetched from './fetch/user-fetched';
import fetchFailed from './fetch/fetch-failed';
import selectIsPostingActions from './actions/select-is-posting-actions';
import postActions from './actions/post-actions';
import postActionsFailed from './actions/post-actions-failed';
import actionsPosted, { ACTIONS_POSTED } from './actions/actions-posted';
import selectUserId from './user-id/select-user-id';
import selectToken from './token/select-token';
import { USER_LOGGED_OUT } from './user-logged-out';
import IS_STORAGE_SUPPORTED from './storage/is-supported';
import getStoredActions from './actions/get-stored-actions';
import storeAction from './actions/store-action';
import deleteStoredActions from './actions/delete-stored-actions';
import { USER_STARTED_ANONYMOUS_SESSION } from './user-started-anonymous-session';
import clearStoredActions from './actions/clear-stored-actions';

const makeSynchronizeUserMiddleware = ({ selectUser }) => (store) => (next) => {
  const actionsToPost = new Set();
  const postingActions = new Set();
  const isReady = IS_STORAGE_SUPPORTED
    ? getStoredActions().then((actions) => {
        actions.forEach((storedAction) => actionsToPost.add(storedAction));
      })
    : Promise.resolve();

  const postActionsAndDispatch = ({
    userState,
    token = selectToken(userState),
    userId = selectUserId(userState),
  }) => {
    return isReady.then(() => {
      const attemptedPostActions = Array.from(actionsToPost).filter(
        (action) => !postingActions.has(action)
      );
      attemptedPostActions.forEach((action) => {
        postingActions.add(action);
      });
      if (attemptedPostActions.length === 0) {
        return Promise.resolve();
      }
      return postActions({ actions: attemptedPostActions, userId, token })
        .finally(() => {
          attemptedPostActions.forEach((action) => {
            postingActions.delete(action);
          });
        })
        .then(({ user }) => {
          if (user === null) {
            store.dispatch(postActionsFailed());
            return;
          }
          attemptedPostActions.forEach((postedAction) => {
            actionsToPost.delete(postedAction);
          });
          if (IS_STORAGE_SUPPORTED) {
            deleteStoredActions(attemptedPostActions).then(() =>
              store.dispatch(actionsPosted({ user }))
            );
          } else {
            store.dispatch(actionsPosted({ user }));
          }
        })
        .catch((err) => {
          console.error(err);
          store.dispatch(postActionsFailed());
        });
    });
  };

  const postActionsIfNotPosting = ({
    userState,
    token = selectToken(userState),
    userId = selectUserId(userState),
  }) => {
    const isPostingActions = selectIsPostingActions(userState);
    if (!isPostingActions) {
      postActionsAndDispatch({ token, userId });
    }
  };

  const fetchUserIfNotPosting = ({
    userState,
    token = selectToken(userState),
    userId = selectUserId(userState),
  }) => {
    isReady.then(() => {
      if (actionsToPost.size > 0) {
        postActionsIfNotPosting({ userState, token, userId });
        return;
      }
      fetchUser({ userId, token })
        .then(({ user, isFresh }) => {
          if (user === null) {
            store.dispatch(fetchFailed());
            return;
          }
          const currentState = store.getState();
          const currentUserState = selectUser(currentState);
          const isPostingActions = selectIsPostingActions(currentUserState);
          if (isPostingActions) {
            // if a post was started before the fetch completed,
            // just wait for that post to complete
            return;
          }
          if ((isFresh || actionsToPost.size === 0) && user !== null) {
            store.dispatch(userFetched({ user }));
          } else {
            store.dispatch(fetchFailed());
          }
        })
        .catch((err) => {
          console.error(err);
          store.dispatch(fetchFailed());
        });
    });
  };

  return (action) => {
    if (action.type === USER_LOGGED_OUT) {
      actionsToPost.clear();
      if (IS_STORAGE_SUPPORTED) {
        clearStoredActions();
      }
      return next(action);
    }
    const state = store.getState();
    const userState = selectUser(state);
    if (action.type === USER_STARTED_ANONYMOUS_SESSION) {
      const previousUserId = selectUserId(userState);
      const shouldClearData = previousUserId !== null;
      action.payload = Object.assign({}, action.payload, {
        shouldClearData,
      });
      if (!shouldClearData) {
        return next(action);
      }
      actionsToPost.clear();
      if (IS_STORAGE_SUPPORTED) {
        clearStoredActions();
      }
      return next(action);
    }
    if (action.type === USER_AUTHENTICATED) {
      const { token, userId } = action.payload;
      const previousUserId = selectUserId(userState);
      if (userId !== previousUserId) {
        action.payload = Object.assign({}, action.payload, {
          shouldClearData: true,
        });
        actionsToPost.clear();
        if (IS_STORAGE_SUPPORTED) {
          clearStoredActions();
        }
      }
      fetchUserIfNotPosting({ userState, token, userId });
      return next(action);
    }
    const token = selectToken(userState);
    if (!token) {
      return next(action);
    }
    if (action.type === ACTIONS_POSTED && actionsToPost.size > 0) {
      postActionsAndDispatch({ userState, token });
      return next(action);
    }
    if (action.type === FETCH_USER) {
      fetchUserIfNotPosting({ userState, token });
      return next(action);
    }
    if (
      !action.meta ||
      typeof action.meta.shouldPost !== 'boolean' ||
      !action.meta.shouldPost
    ) {
      return next(action);
    }
    actionsToPost.add(action);
    if (IS_STORAGE_SUPPORTED) {
      storeAction(action).then(() =>
        postActionsIfNotPosting({ userState, token })
      );
    } else {
      postActionsIfNotPosting({ userState, token });
    }
    return next(action);
  };
};

export default makeSynchronizeUserMiddleware;
