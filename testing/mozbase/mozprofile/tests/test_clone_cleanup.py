#!/usr/bin/env python

# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this file,
# You can obtain one at http://mozilla.org/MPL/2.0/.


import os
import tempfile
import unittest
from mozprofile.profile import Profile

class CloneCleanupTest(unittest.TestCase):
    """
    test cleanup logic for the clone functionality
    see https://bugzilla.mozilla.org/show_bug.cgi?id=642843
    """

    def setUp(self):
        # make a profile with one preference
        path = tempfile.mktemp()
        self.profile = Profile(path,
                          preferences={'foo': 'bar'},
                          restore=False)
        user_js = os.path.join(self.profile.profile, 'user.js')
        self.assertTrue(os.path.exists(user_js))

    def test_restore_true(self):
        # make a clone of this profile with restore=True
        clone = Profile.clone(self.profile.profile, restore=True)

        clone.cleanup()

        # clone should be deleted
        self.assertFalse(os.path.exists(clone.profile))

    def test_restore_false(self):
        # make a clone of this profile with restore=False
        clone = Profile.clone(self.profile.profile, restore=False)

        clone.cleanup()

        # clone should still be around on the filesystem
        self.assertTrue(os.path.exists(clone.profile))


if __name__ == '__main__':
    unittest.main()

