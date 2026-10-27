package it.filippo.biostv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Android closes the app while it replaces it: as soon as the new version is in place, reopen it. */
public class UpdateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (i == null || !Intent.ACTION_MY_PACKAGE_REPLACED.equals(i.getAction())) return;
        Updater.reopenIfJustUpdated(c);
    }
}
