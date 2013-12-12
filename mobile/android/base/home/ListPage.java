/* -*- Mode: Java; c-basic-offset: 4; tab-width: 20; indent-tabs-mode: nil; -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.gecko.home;

import org.mozilla.gecko.R;
import org.mozilla.gecko.home.HomePager.OnUrlOpenListener;
import org.mozilla.gecko.home.HomeConfig.PageEntry;

import android.app.Activity;
import android.content.Context;
import android.content.res.Configuration;
import android.database.Cursor;
import android.os.Bundle;
import android.support.v4.app.LoaderManager.LoaderCallbacks;
import android.support.v4.content.Loader;
import android.support.v4.widget.CursorAdapter;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ListView;

import java.util.EnumSet;

/**
 * Fragment that displays custom lists.
 */
public class ListPage extends HomeFragment {
    // Cursor loader ID for the lists
    private static final int LOADER_ID_LIST = 0;

    // The page entry associated with this page
    private PageEntry mPageEntry;

    // Adapter for the list
    private HomeListAdapter mAdapter;

    // The view shown by the fragment
    private ListView mList;

    // Callbacks used for the list loader
    private CursorLoaderCallbacks mCursorLoaderCallbacks;

    // On URL open listener
    private OnUrlOpenListener mUrlOpenListener;

    @Override
    public void onAttach(Activity activity) {
        super.onAttach(activity);

        try {
            mUrlOpenListener = (OnUrlOpenListener) activity;
        } catch (ClassCastException e) {
            throw new ClassCastException(activity.toString()
                    + " must implement HomePager.OnUrlOpenListener");
        }
    }

    @Override
    public void onDetach() {
        super.onDetach();

        mUrlOpenListener = null;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final Bundle args = getArguments();
        if (args != null) {
            mPageEntry = (PageEntry) args.getParcelable(HomePager.PAGE_ENTRY_ARG);
        }

        if (mPageEntry == null) {
            throw new IllegalStateException("Can't create a ListPage without a PageEntry");
        }
    }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        mList = new HomeListView(getActivity());
        return mList;
    }

    @Override
    public void onViewCreated(View view, Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        registerForContextMenu(mList);
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        mList = null;
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);

        // Detach and reattach the fragment as the layout changes.
        if (isVisible()) {
            getFragmentManager().beginTransaction()
                                .detach(this)
                                .attach(this)
                                .commitAllowingStateLoss();
        }
    }

    @Override
    public void onActivityCreated(Bundle savedInstanceState) {
        super.onActivityCreated(savedInstanceState);

        mAdapter = new HomeListAdapter(getActivity(), null);
        mList.setAdapter(mAdapter);

        // Create callbacks before the initial loader is started.
        mCursorLoaderCallbacks = new CursorLoaderCallbacks();
        loadIfVisible();
    }

    @Override
    protected void load() {
        getLoaderManager().initLoader(LOADER_ID_LIST, null, mCursorLoaderCallbacks);
    }

    /**
     * Cursor loader for the lists.
     */
    private static class HomeListLoader extends SimpleCursorLoader {
        public HomeListLoader(Context context) {
            super(context);
        }

        @Override
        public Cursor loadCursor() {
            // Do nothing
            return null;
        }
    }

    /**
     * Cursor adapter for the list.
     */
    private class HomeListAdapter extends CursorAdapter {
        public HomeListAdapter(Context context, Cursor cursor) {
            super(context, cursor, 0);
        }

        @Override
        public void bindView(View view, Context context, Cursor cursor) {
            final TwoLinePageRow row = (TwoLinePageRow) view;
            row.updateFromCursor(cursor);
        }

        @Override
        public View newView(Context context, Cursor cursor, ViewGroup parent) {
            return LayoutInflater.from(parent.getContext()).inflate(R.layout.bookmark_item_row, parent, false);
        }
    }

    /**
     * LoaderCallbacks implementation that interacts with the LoaderManager.
     */
    private class CursorLoaderCallbacks implements LoaderCallbacks<Cursor> {
        @Override
        public Loader<Cursor> onCreateLoader(int id, Bundle args) {
            return new HomeListLoader(getActivity());
        }

        @Override
        public void onLoadFinished(Loader<Cursor> loader, Cursor c) {
            mAdapter.swapCursor(c);
        }

        @Override
        public void onLoaderReset(Loader<Cursor> loader) {
            mAdapter.swapCursor(null);
        }
    }
}
